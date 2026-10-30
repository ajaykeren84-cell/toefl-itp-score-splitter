const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Reads image width and height from JPEG header (SOF0 marker) in pure JS.
 */
function getJpgDimensions(jpgPath) {
    try {
        const imgBuf = fs.readFileSync(jpgPath);
        let offset = 2;
        while (offset < imgBuf.length) {
            if (imgBuf[offset] !== 0xFF) break;
            const marker = imgBuf[offset + 1];
            if (marker === 0xC0 || marker === 0xC2) {
                const height = imgBuf.readUInt16BE(offset + 5);
                const width = imgBuf.readUInt16BE(offset + 7);
                return { width, height };
            }
            const len = imgBuf.readUInt16BE(offset + 2);
            offset += 2 + len;
        }
    } catch (e) {}
    return { width: 1653, height: 2338 };
}

/**
 * Extracts ALL embedded JPEG images from a multi-page scanned PDF.
 */
function extractAllImagesFromPdf(pdfPath, outDir, baseName) {
    const buf = fs.readFileSync(pdfPath);
    const pages = [];
    let pos = 0;
    let pageNum = 1;

    while (pos < buf.length) {
        let idx1 = buf.indexOf(Buffer.from('/Subtype/Image', 'latin1'), pos);
        let idx2 = buf.indexOf(Buffer.from('/Subtype /Image', 'latin1'), pos);
        let idx = -1;
        if (idx1 !== -1 && idx2 !== -1) idx = Math.min(idx1, idx2);
        else if (idx1 !== -1) idx = idx1;
        else if (idx2 !== -1) idx = idx2;

        if (idx === -1) break;

        let streamStart = buf.indexOf(Buffer.from('stream', 'latin1'), idx);
        if (streamStart !== -1) {
            let actualDataStart = streamStart + 6;
            if (buf[actualDataStart] === 0x0d) actualDataStart++;
            if (buf[actualDataStart] === 0x0a) actualDataStart++;

            let endStreamIdx = buf.indexOf(Buffer.from('endstream', 'latin1'), actualDataStart);
            if (endStreamIdx !== -1) {
                const imgBuf = buf.subarray(actualDataStart, endStreamIdx);
                // Verify JPEG signature
                if (imgBuf[0] === 0xFF && imgBuf[1] === 0xD8) {
                    const outPath = path.join(outDir, `${baseName}_page_${pageNum}.jpg`);
                    fs.writeFileSync(outPath, imgBuf);
                    pages.push({
                        pageNum,
                        imagePath: outPath,
                        previewUrl: `/storage/uploads/${path.basename(outPath)}`
                    });
                    pageNum++;
                }
            }
        }
        pos = idx + 14;
    }

    return pages;
}

/**
 * Detects horizontal split cutlines for 3-part TOEFL report using pure JS.
 */
function detectCutLines(imagePath) {
    const { width, height } = getJpgDimensions(imagePath);
    
    let cut1 = 780;
    let cut2 = 1520;
    let cut3 = 2195;

    if (height > 0) {
        cut1 = Math.round(height * 0.333);
        cut2 = Math.round(height * 0.650);
        cut3 = Math.round(height * 0.938);
    }

    return { width: width || 1653, height: height || 2338, cut1, cut2, cut3 };
}

/**
 * Crops the 3 sections from a page image using PowerShell System.Drawing.
 */
function cropSections(imagePath, cuts, outputDir, baseName) {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const cut1 = parseInt(cuts.cut1, 10) || 780;
    const cut2 = parseInt(cuts.cut2, 10) || 1520;
    const cut3 = parseInt(cuts.cut3, 10) || 2195;

    const psScriptPath = path.join(__dirname, 'crop.ps1');
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}" -srcPath "${imagePath}" -cut1 ${cut1} -cut2 ${cut2} -cut3 ${cut3} -outDir "${outputDir}" -baseName "${baseName}"`;

    execSync(cmd, { encoding: 'utf8' });

    const part1Path = path.join(outputDir, `${baseName}_part1.jpg`);
    const part2Path = path.join(outputDir, `${baseName}_part2.jpg`);
    const part3Path = path.join(outputDir, `${baseName}_part3.jpg`);

    return [part1Path, part2Path, part3Path];
}

/**
 * Creates a clean, standard 1-page PDF embedding the cropped JPEG.
 */
function createPdfFromJpg(jpgPath, outPdfPath) {
    const imgBuf = fs.readFileSync(jpgPath);

    let width = 1653, height = 750;
    let offset = 2;
    while (offset < imgBuf.length) {
        if (imgBuf[offset] !== 0xFF) break;
        const marker = imgBuf[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
            height = imgBuf.readUInt16BE(offset + 5);
            width = imgBuf.readUInt16BE(offset + 7);
            break;
        }
        const len = imgBuf.readUInt16BE(offset + 2);
        offset += 2 + len;
    }

    const ptWidth = (width * 72 / 200).toFixed(2);
    const ptHeight = (height * 72 / 200).toFixed(2);
    const streamContent = `q ${ptWidth} 0 0 ${ptHeight} 0 0 cm /Im0 Do Q`;
    const streamLen = Buffer.byteLength(streamContent);

    const offsets = [];
    let pdf = '%PDF-1.4\n';

    function addObj(content) {
        offsets.push(Buffer.byteLength(pdf, 'latin1'));
        pdf += content + '\n';
    }

    addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
    addObj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
    addObj(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptWidth} ${ptHeight}] /Contents 4 0 R /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 5 0 R >> >> >>\nendobj`);
    addObj(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj`);

    const imgHeader = `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBuf.length} >>\nstream\n`;
    const imgFooter = '\nendstream\nendobj';

    offsets.push(Buffer.byteLength(pdf, 'latin1'));

    const part1Buf = Buffer.from(pdf + imgHeader, 'latin1');
    const part2Buf = imgBuf;

    let trailer = imgFooter + '\n';
    const xrefOffset = part1Buf.length + part2Buf.length + Buffer.byteLength(trailer, 'latin1');

    trailer += 'xref\n0 6\n0000000000 65535 f \r\n';
    for (let i = 0; i < offsets.length; i++) {
        trailer += offsets[i].toString().padStart(10, '0') + ' 00000 n \r\n';
    }
    trailer += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const finalBuf = Buffer.concat([part1Buf, part2Buf, Buffer.from(trailer, 'latin1')]);
    fs.writeFileSync(outPdfPath, finalBuf);
    return outPdfPath;
}

module.exports = {
    getJpgDimensions,
    extractAllImagesFromPdf,
    detectCutLines,
    cropSections,
    createPdfFromJpg
};
