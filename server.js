const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { extractAllImagesFromPdf, detectCutLines, cropSections, createPdfFromJpg } = require('./lib/imageProcessor');
const { extractReportData, getCefr } = require('./lib/ocrExtractor');
const { generateExcelReport } = require('./lib/excelGenerator');

function formatCleanFilename(partNum, studentName, ext) {
    const cleanName = (studentName || `Peserta ${partNum}`)
        .replace(/[,_]/g, ' ')
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\.+$/, '');
    return `${partNum}. ${cleanName}.${ext}`;
}

const app = express();
const PORT = process.env.PORT || 3800;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/storage', express.static(path.join(__dirname, 'storage')));

// Storage folders
const STORAGE_DIR = path.join(__dirname, 'storage');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
const OUTPUT_DIR = path.join(STORAGE_DIR, 'output');

[STORAGE_DIR, UPLOADS_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ dest: UPLOADS_DIR });

// In-memory session store
let currentSession = {
    scanId: null,
    totalPages: 0,
    pages: [],
    cut1: 780,
    cut2: 1520,
    cut3: 2195,
    reports: [],
    excelPath: null
};

// Real-time processing progress
let processProgress = {
    status: 'idle',
    current: 0,
    total: 0,
    page: 0,
    totalPages: 0,
    currentStudent: ''
};

/**
 * Progress endpoint for real-time frontend updates
 */
app.get('/api/progress', (req, res) => {
    res.json(processProgress);
});

/**
 * 1. Upload multi-page scan/PDF & extract all pages
 */
app.post('/api/upload', upload.single('document'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const ext = path.extname(req.file.originalname).toLowerCase();
        const scanId = `batch_${Date.now()}`;
        let extractedPages = [];

        if (ext === '.pdf') {
            extractedPages = extractAllImagesFromPdf(req.file.path, UPLOADS_DIR, scanId);
            if (extractedPages.length === 0) {
                const fallbackJpg = path.join(UPLOADS_DIR, `${scanId}_page_1.jpg`);
                fs.copyFileSync(req.file.path, fallbackJpg);
                extractedPages.push({
                    pageNum: 1,
                    imagePath: fallbackJpg,
                    previewUrl: `/storage/uploads/${scanId}_page_1.jpg`
                });
            }
        } else {
            const singleJpg = path.join(UPLOADS_DIR, `${scanId}_page_1.jpg`);
            fs.copyFileSync(req.file.path, singleJpg);
            extractedPages.push({
                pageNum: 1,
                imagePath: singleJpg,
                previewUrl: `/storage/uploads/${scanId}_page_1.jpg`
            });
        }

        try { fs.unlinkSync(req.file.path); } catch (e) {}

        const firstPageDetection = detectCutLines(extractedPages[0].imagePath);

        currentSession = {
            scanId,
            totalPages: extractedPages.length,
            pages: extractedPages,
            cut1: firstPageDetection.cut1 || 780,
            cut2: firstPageDetection.cut2 || 1520,
            cut3: firstPageDetection.cut3 || 2195,
            width: firstPageDetection.width || 1653,
            height: firstPageDetection.height || 2338,
            reports: [],
            excelPath: null
        };

        processProgress = {
            status: 'idle',
            current: 0,
            total: extractedPages.length * 3,
            page: 0,
            totalPages: extractedPages.length,
            currentStudent: ''
        };

        res.json({
            success: true,
            scanId: currentSession.scanId,
            totalPages: currentSession.totalPages,
            pages: currentSession.pages.map(p => ({ pageNum: p.pageNum, previewUrl: p.previewUrl })),
            previewUrl: currentSession.pages[0].previewUrl,
            width: currentSession.width,
            height: currentSession.height,
            cut1: currentSession.cut1,
            cut2: currentSession.cut2,
            cut3: currentSession.cut3
        });
    } catch (err) {
        console.error('Upload Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 2. Process all pages with parallel OCR per page and progress reporting
 */
app.post('/api/process', async (req, res) => {
    try {
        const { scanId, cut1, cut2, cut3 } = req.body;
        if (!currentSession.pages.length) {
            return res.status(400).json({ error: 'No active pages found. Please upload a document first.' });
        }

        currentSession.cut1 = cut1 || currentSession.cut1;
        currentSession.cut2 = cut2 || currentSession.cut2;
        currentSession.cut3 = cut3 || currentSession.cut3;

        const totalExpected = currentSession.pages.length * 3;
        processProgress = {
            status: 'processing',
            current: 0,
            total: totalExpected,
            page: 1,
            totalPages: currentSession.pages.length,
            currentStudent: 'Memulai pemotongan...'
        };

        const reports = [];
        let overallNumber = 1;

        console.log(`Starting processing for ${currentSession.pages.length} pages (${totalExpected} participants)...`);

        for (let pIdx = 0; pIdx < currentSession.pages.length; pIdx++) {
            const page = currentSession.pages[pIdx];
            const pageBaseName = `${currentSession.scanId}_p${page.pageNum}`;

            processProgress.page = page.pageNum;
            processProgress.currentStudent = `Memproses Halaman ${page.pageNum} dari ${currentSession.pages.length}...`;

            // 1. Crop 3 sections for this page
            const croppedJpgs = cropSections(
                page.imagePath,
                { cut1: currentSession.cut1, cut2: currentSession.cut2, cut3: currentSession.cut3 },
                OUTPUT_DIR,
                pageBaseName
            );

            // 2. Generate PDFs immediately
            const pdfPaths = croppedJpgs.map((jpgPath, k) => {
                const pdfPath = path.join(OUTPUT_DIR, `${pageBaseName}_part${k + 1}.pdf`);
                createPdfFromJpg(jpgPath, pdfPath);
                return pdfPath;
            });

            // 3. Parallel OCR extraction for the 3 parts (3x faster!)
            const extractedResults = await Promise.all(
                croppedJpgs.map(jpgPath => extractReportData(jpgPath))
            );

            // 4. Build report objects
            for (let k = 0; k < 3; k++) {
                const jpgPath = croppedJpgs[k];
                const pdfPath = pdfPaths[k];
                const extracted = extractedResults[k];
                const currentNum = overallNumber++;

                const cleanName = extracted.student_name || `Peserta ${currentNum}`;
                const pdfFilename = formatCleanFilename(currentNum, cleanName, 'pdf');
                const jpgFilename = formatCleanFilename(currentNum, cleanName, 'jpg');

                const report = {
                    id: `rep_${currentSession.scanId}_p${page.pageNum}_${k + 1}`,
                    pageNum: page.pageNum,
                    part: k + 1,
                    overallNumber: currentNum,
                    student_name: cleanName,
                    student_number: extracted.student_number || `04091926${currentNum}0000`,
                    dob: extracted.dob || '01 Jan 2012',
                    sex: extracted.sex || 'M',
                    institution_name: extracted.institution_name || 'ONE STOP ENGLISH EDUCATION',
                    test_date: extracted.test_date || '12 Sep 2026',
                    form_type: extracted.form_type || 'TOEFL ITP Level 1',
                    listening_score: extracted.listening_score || 45,
                    listening_cefr: extracted.listening_cefr || 'B1',
                    structure_score: extracted.structure_score || 45,
                    structure_cefr: extracted.structure_cefr || 'B1',
                    reading_score: extracted.reading_score || 45,
                    reading_cefr: extracted.reading_cefr || 'B1',
                    total_score: extracted.total_score || 450,
                    total_cefr: extracted.total_cefr || 'B1',
                    is_consistent: extracted.is_consistent,
                    jpg_path: jpgPath,
                    jpg_filename: jpgFilename,
                    jpg_url: `/storage/output/${path.basename(jpgPath)}`,
                    pdf_path: pdfPath,
                    pdf_filename: pdfFilename,
                    pdf_url: `/storage/output/${path.basename(pdfPath)}`
                };

                reports.push(report);
                processProgress.current = reports.length;
                processProgress.currentStudent = cleanName;
            }
        }

        // Generate Master Excel Summary
        const excelPath = path.join(OUTPUT_DIR, `${currentSession.scanId}_Rekap_Nilai_TOEFL.xlsx`);
        generateExcelReport(reports, excelPath);

        currentSession.reports = reports;
        currentSession.excelPath = excelPath;

        processProgress.status = 'completed';
        console.log(`Processing complete! Extracted ${reports.length} participants.`);

        res.json({
            success: true,
            totalReports: reports.length,
            reports,
            excelUrl: `/api/download/excel`
        });
    } catch (err) {
        processProgress.status = 'error';
        console.error('Process Error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 3. Update report field manually
 */
app.put('/api/reports/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const report = currentSession.reports.find(r => r.id === id);
    if (!report) {
        return res.status(404).json({ error: 'Report not found' });
    }

    Object.assign(report, updates);

    if (updates.student_name !== undefined) {
        report.jpg_filename = formatCleanFilename(report.overallNumber, report.student_name, 'jpg');
        report.pdf_filename = formatCleanFilename(report.overallNumber, report.student_name, 'pdf');
    }

    if (updates.listening_score !== undefined) {
        report.listening_score = parseInt(updates.listening_score, 10);
        report.listening_cefr = getCefr('listening', report.listening_score);
    }
    if (updates.structure_score !== undefined) {
        report.structure_score = parseInt(updates.structure_score, 10);
        report.structure_cefr = getCefr('structure', report.structure_score);
    }
    if (updates.reading_score !== undefined) {
        report.reading_score = parseInt(updates.reading_score, 10);
        report.reading_cefr = getCefr('reading', report.reading_score);
    }
    if (updates.total_score !== undefined) {
        report.total_score = parseInt(updates.total_score, 10);
        report.total_cefr = getCefr('total', report.total_score);
    }

    const expected = Math.round(((report.listening_score + report.structure_score + report.reading_score) / 3) * 10);
    report.is_consistent = Math.abs(expected - report.total_score) <= 2;

    if (currentSession.excelPath) {
        generateExcelReport(currentSession.reports, currentSession.excelPath);
    }

    res.json({ success: true, report });
});

/**
 * 4. Downloads
 */
app.get('/api/download/pdf/:id', (req, res) => {
    const report = currentSession.reports.find(r => r.id === req.params.id);
    if (!report || !fs.existsSync(report.pdf_path)) {
        return res.status(404).send('PDF not found');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.pdf_filename}"`);
    fs.createReadStream(report.pdf_path).pipe(res);
});

app.get('/api/download/jpg/:id', (req, res) => {
    const report = currentSession.reports.find(r => r.id === req.params.id);
    if (!report || !fs.existsSync(report.jpg_path)) {
        return res.status(404).send('JPG not found');
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${report.jpg_filename}"`);
    fs.createReadStream(report.jpg_path).pipe(res);
});

app.get('/api/download/excel', (req, res) => {
    if (!currentSession.excelPath || !fs.existsSync(currentSession.excelPath)) {
        return res.status(404).send('Excel file not found');
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Rekap Nilai TOEFL ITP.xlsx"');
    fs.createReadStream(currentSession.excelPath).pipe(res);
});

app.get('/api/download/zip', (req, res) => {
    if (!currentSession.reports.length) {
        return res.status(400).send('No reports to package');
    }

    try {
        const batchFolder = path.join(OUTPUT_DIR, `package_${currentSession.scanId}`);
        const pdfFolder = path.join(batchFolder, 'PDFs');
        const jpgFolder = path.join(batchFolder, 'JPGs');

        [batchFolder, pdfFolder, jpgFolder].forEach(d => {
            if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
        });

        currentSession.reports.forEach(r => {
            if (fs.existsSync(r.pdf_path)) {
                fs.copyFileSync(r.pdf_path, path.join(pdfFolder, r.pdf_filename));
            }
            if (fs.existsSync(r.jpg_path)) {
                fs.copyFileSync(r.jpg_path, path.join(jpgFolder, r.jpg_filename));
            }
        });

        if (currentSession.excelPath && fs.existsSync(currentSession.excelPath)) {
            fs.copyFileSync(currentSession.excelPath, path.join(batchFolder, 'Rekap Nilai TOEFL ITP.xlsx'));
        }

        const zipPath = path.resolve(OUTPUT_DIR, `TOEFL_ITP_Batch_${currentSession.scanId}.zip`);
        const { execSync } = require('child_process');
        
        const psCmd = `powershell -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path '${zipPath.replace(/'/g, "''")}') { Remove-Item '${zipPath.replace(/'/g, "''")}' -Force }; [System.IO.Compression.ZipFile]::CreateFromDirectory('${batchFolder.replace(/'/g, "''")}', '${zipPath.replace(/'/g, "''")}')"`;
        execSync(psCmd);

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="TOEFL ITP Batch Hasil Potong.zip"');
        const filestream = fs.createReadStream(zipPath);
        filestream.pipe(res);
    } catch (err) {
        console.error('ZIP Error:', err);
        res.status(500).send('Failed to generate ZIP archive: ' + err.message);
    }
});

// Start Server with generous timeout
const server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 TOEFL Score Splitter Multi-Page Running on:`);
    console.log(`👉 http://localhost:${PORT}`);
    console.log(`=======================================================`);
});

server.timeout = 900000;
server.keepAliveTimeout = 900000;
