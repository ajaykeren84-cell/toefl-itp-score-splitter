let currentScan = null;
let currentImage = new Image();
let canvas = null;
let ctx = null;

let isDragging = null; // 'cut1' or 'cut2'
let currentPageIndex = 0;
let allReports = [];
let progressInterval = null;

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('split-canvas');
    ctx = canvas.getContext('2d');

    setupUploadEvents();
    setupCanvasEvents();
    setupActionButtons();
    setupSearchFilter();
});

function setupUploadEvents() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-indigo-500', 'bg-indigo-50/50');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-indigo-500', 'bg-indigo-50/50');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-indigo-500', 'bg-indigo-50/50');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
        }
    });

    document.getElementById('use-sample-btn').addEventListener('click', async () => {
        showLoading(true);
        try {
            const res = await fetch('/storage/uploads/sample_multipage.pdf');
            if (res.ok) {
                const blob = await res.blob();
                handleFileUpload(new File([blob], 'Sample_TOEFL_5Pages.pdf', { type: 'application/pdf' }));
            } else {
                throw new Error('Berkas sampel tidak ditemukan');
            }
        } catch (e) {
            alert('Error memuat sampel: ' + e.message);
            showLoading(false);
        }
    });
}

async function handleFileUpload(file) {
    showLoading(true);
    const formData = new FormData();
    formData.append('document', file);

    try {
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal mengunggah berkas');

        currentScan = data;
        currentPageIndex = 0;

        document.getElementById('page-count-badge').innerText = `${data.totalPages} Halaman (${data.totalPages * 3} Peserta)`;
        updatePageIndicator();

        loadCanvasImage(data.pages[0].previewUrl, data.cut1, data.cut2, data.cut3);
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function showLoading(show) {
    const el = document.getElementById('upload-loading');
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

function updatePageIndicator() {
    if (!currentScan || !currentScan.pages) return;
    const total = currentScan.pages.length;
    document.getElementById('page-indicator').innerText = `Hal ${currentPageIndex + 1} / ${total}`;
    document.getElementById('prev-page-btn').disabled = (currentPageIndex === 0);
    document.getElementById('next-page-btn').disabled = (currentPageIndex === total - 1);
}

function loadCanvasImage(url, cut1, cut2, cut3) {
    currentImage.src = url;
    currentImage.onload = () => {
        setStep(2);

        canvas.width = currentImage.naturalWidth;
        canvas.height = currentImage.naturalHeight;

        currentScan.cut1 = cut1;
        currentScan.cut2 = cut2;
        currentScan.cut3 = cut3;

        drawSplitter();
    };
}

function drawSplitter() {
    if (!currentImage.src) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(currentImage, 0, 0);

    const w = canvas.width;

    // Draw Cut Line 1 (Rose Red)
    ctx.save();
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 5;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(0, currentScan.cut1);
    ctx.lineTo(w, currentScan.cut1);
    ctx.stroke();

    // Line 1 Handle Badge
    ctx.fillStyle = '#f43f5e';
    ctx.fillRect(20, currentScan.cut1 - 22, 170, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`Garis 1: Y=${Math.round(currentScan.cut1)}`, 30, currentScan.cut1 + 7);
    ctx.restore();

    // Draw Cut Line 2 (Dodger Blue)
    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 5;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(0, currentScan.cut2);
    ctx.lineTo(w, currentScan.cut2);
    ctx.stroke();

    // Line 2 Handle Badge
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(20, currentScan.cut2 - 22, 170, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`Garis 2: Y=${Math.round(currentScan.cut2)}`, 30, currentScan.cut2 + 7);
    ctx.restore();

    document.getElementById('badge-cut1').innerText = `Y=${Math.round(currentScan.cut1)}`;
    document.getElementById('badge-cut2').innerText = `Y=${Math.round(currentScan.cut2)}`;
}

function setupCanvasEvents() {
    function getCanvasY(e) {
        const rect = canvas.getBoundingClientRect();
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const yOnScreen = clientY - rect.top;
        return (yOnScreen / rect.height) * canvas.height;
    }

    function checkHit(y) {
        const threshold = 40;
        if (Math.abs(y - currentScan.cut1) < threshold) return 'cut1';
        if (Math.abs(y - currentScan.cut2) < threshold) return 'cut2';
        return null;
    }

    canvas.addEventListener('mousedown', (e) => {
        const y = getCanvasY(e);
        const hit = checkHit(y);
        if (hit) {
            isDragging = hit;
            canvas.style.cursor = 'ns-resize';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging || !currentScan) return;
        const y = getCanvasY(e);
        if (isDragging === 'cut1') {
            currentScan.cut1 = Math.max(200, Math.min(y, currentScan.cut2 - 150));
        } else if (isDragging === 'cut2') {
            currentScan.cut2 = Math.max(currentScan.cut1 + 150, Math.min(y, canvas.height - 150));
        }
        drawSplitter();
    });

    window.addEventListener('mouseup', () => {
        isDragging = null;
        if (canvas) canvas.style.cursor = 'default';
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!currentScan || isDragging) return;
        const y = getCanvasY(e);
        const hit = checkHit(y);
        canvas.style.cursor = hit ? 'ns-resize' : 'default';
    });

    // Page switcher events
    document.getElementById('prev-page-btn').addEventListener('click', () => {
        if (currentPageIndex > 0) {
            currentPageIndex--;
            updatePageIndicator();
            loadCanvasImage(currentScan.pages[currentPageIndex].previewUrl, currentScan.cut1, currentScan.cut2, currentScan.cut3);
        }
    });

    document.getElementById('next-page-btn').addEventListener('click', () => {
        if (currentPageIndex < currentScan.pages.length - 1) {
            currentPageIndex++;
            updatePageIndicator();
            loadCanvasImage(currentScan.pages[currentPageIndex].previewUrl, currentScan.cut1, currentScan.cut2, currentScan.cut3);
        }
    });
}

function startProgressPolling() {
    const card = document.getElementById('progress-card');
    card.classList.remove('hidden');

    const fill = document.getElementById('progress-fill');
    const percent = document.getElementById('progress-percent');
    const statusText = document.getElementById('progress-status-text');
    const subtext = document.getElementById('progress-subtext');
    const count = document.getElementById('progress-count');

    progressInterval = setInterval(async () => {
        try {
            const res = await fetch('/api/progress');
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'processing') {
                    const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
                    fill.style.width = `${pct}%`;
                    percent.innerText = `${pct}%`;
                    statusText.innerHTML = `<svg class="animate-spin h-4 w-4 text-indigo-600 inline mr-2" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Memproses Halaman ${data.page} dari ${data.totalPages}...`;
                    subtext.innerText = data.currentStudent ? `Mengekstrak: ${data.currentStudent}` : 'Menganalisis dokumen...';
                    count.innerText = `${data.current} / ${data.total} Peserta`;
                }
            }
        } catch (e) {}
    }, 400);
}

function stopProgressPolling() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
    const card = document.getElementById('progress-card');
    card.classList.add('hidden');
}

function setupActionButtons() {
    document.getElementById('start-process-btn').addEventListener('click', async () => {
        const btn = document.getElementById('start-process-btn');
        btn.disabled = true;
        btn.innerHTML = `<svg class="animate-spin h-4 w-4 mr-2 inline" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Memproses ${currentScan.totalPages} Halaman...`;

        startProgressPolling();

        try {
            const res = await fetch('/api/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scanId: currentScan.scanId,
                    cut1: Math.round(currentScan.cut1),
                    cut2: Math.round(currentScan.cut2),
                    cut3: Math.round(currentScan.cut3)
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Proses gagal');

            allReports = data.reports;
            document.getElementById('total-reports-text').innerText = `${allReports.length} Peserta`;
            document.getElementById('total-count').innerText = allReports.length;
            document.getElementById('visible-count').innerText = allReports.length;

            renderResults(allReports);
            setStep(3);
        } catch (err) {
            alert('Error pemrosesan: ' + err.message);
        } finally {
            stopProgressPolling();
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="play" class="w-4 h-4 mr-2 inline"></i> Proses Semua Halaman & OCR`;
            if (window.lucide) { lucide.createIcons(); }
        }
    });

    document.getElementById('reset-btn').addEventListener('click', () => {
        if (confirm('Mulai proses dokumen baru?')) {
            setStep(1);
        }
    });
}

function setupSearchFilter() {
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const cards = document.querySelectorAll('#cards-container > div');
        let count = 0;

        cards.forEach(card => {
            const text = card.innerText.toLowerCase();
            if (!query || text.includes(query)) {
                card.classList.remove('hidden');
                count++;
            } else {
                card.classList.add('hidden');
            }
        });

        document.getElementById('visible-count').innerText = count;
    });
}

function setStep(step) {
    const s1Badge = document.getElementById('step-badge-1');
    const s2Badge = document.getElementById('step-badge-2');
    const s3Badge = document.getElementById('step-badge-3');

    const uploadSec = document.getElementById('upload-section');
    const splitterSec = document.getElementById('splitter-section');
    const resultsSec = document.getElementById('results-section');

    [uploadSec, splitterSec, resultsSec].forEach(el => el.classList.add('hidden'));

    function resetBadge(b, num, active) {
        if (active) {
            b.className = 'flex items-center gap-3 p-3 rounded-xl border border-indigo-500 bg-indigo-50 text-indigo-700 transition';
            b.querySelector('div:first-child').className = 'w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-sm';
        } else {
            b.className = 'flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white text-slate-400 transition';
            b.querySelector('div:first-child').className = 'w-8 h-8 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-sm';
        }
    }

    resetBadge(s1Badge, 1, step === 1);
    resetBadge(s2Badge, 2, step === 2);
    resetBadge(s3Badge, 3, step === 3);

    if (step === 1) uploadSec.classList.remove('hidden');
    else if (step === 2) splitterSec.classList.remove('hidden');
    else if (step === 3) resultsSec.classList.remove('hidden');

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderResults(reports) {
    const container = document.getElementById('cards-container');
    container.innerHTML = '';

    reports.forEach((r) => {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:flex-row';
        card.id = `card-${r.id}`;

        const isMatch = r.is_consistent;
        const badgeColor = isMatch ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200';
        const badgeIcon = isMatch ? 'check-circle' : 'alert-triangle';
        const badgeText = isMatch ? 'Skor Valid' : 'Perlu Ditinjau';

        const safeName = escapeHtml(r.student_name);
        const safeStudentId = escapeHtml(r.student_number);
        const safeDob = escapeHtml(r.dob);
        const safeTestDate = escapeHtml(r.test_date);

        card.innerHTML = `
            <!-- Left Side: Image Preview -->
            <div class="lg:w-1/2 p-6 bg-slate-50 border-r border-slate-200 flex flex-col justify-between">
                <div>
                    <div class="flex items-center justify-between mb-3">
                        <span class="px-3 py-1 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
                            Peserta #${r.overallNumber} (Hal ${r.pageNum} - Bagian ${r.part})
                        </span>
                        <button type="button" class="preview-btn text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1" data-img-url="${r.jpg_url}" data-name="${safeName}">
                            <i data-lucide="maximize-2" class="w-3.5 h-3.5"></i> Perbesar Gambar
                        </button>
                    </div>
                    <div class="preview-img-wrap rounded-xl overflow-hidden border border-slate-300 shadow-sm bg-white cursor-pointer hover:shadow-md transition" data-img-url="${r.jpg_url}" data-name="${safeName}">
                        <img src="${r.jpg_url}" alt="${safeName}" class="w-full h-auto object-cover">
                    </div>
                </div>
                <div class="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between gap-3">
                    <span class="text-xs font-medium text-slate-500 font-mono">${escapeHtml(r.pdf_filename)}</span>
                    <div class="flex gap-2">
                        <a href="/api/download/jpg/${r.id}" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 flex items-center gap-1 shadow-xs">
                            <i data-lucide="image" class="w-3.5 h-3.5"></i> JPG
                        </a>
                        <a href="/api/download/pdf/${r.id}" class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white flex items-center gap-1 shadow-xs">
                            <i data-lucide="file-text" class="w-3.5 h-3.5"></i> PDF
                        </a>
                    </div>
                </div>
            </div>

            <!-- Right Side: Editable Data Form -->
            <div class="lg:w-1/2 p-6 flex flex-col justify-between">
                <div>
                    <div class="flex items-center justify-between mb-4">
                        <h3 class="text-base font-bold text-slate-900">Rincian Data Peserta #${r.overallNumber}</h3>
                        <span id="badge-status-${r.id}" class="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border ${badgeColor}">
                            <i data-lucide="${badgeIcon}" class="w-3.5 h-3.5"></i> <span class="badge-text">${badgeText}</span>
                        </span>
                    </div>

                    <div class="grid grid-cols-2 gap-4 text-xs">
                        <div class="col-span-2">
                            <label class="block font-medium text-slate-500 mb-1">Nama Lengkap Siswa</label>
                            <input type="text" value="${safeName}" onchange="updateField('${r.id}', 'student_name', this.value)" class="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold text-slate-800 focus:outline-indigo-500 text-sm">
                        </div>
                        <div>
                            <label class="block font-medium text-slate-500 mb-1">Student Number</label>
                            <input type="text" value="${safeStudentId}" onchange="updateField('${r.id}', 'student_number', this.value)" class="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-slate-800 focus:outline-indigo-500 text-xs">
                        </div>
                        <div>
                            <label class="block font-medium text-slate-500 mb-1">Tanggal Lahir (DOB)</label>
                            <input type="text" value="${safeDob}" onchange="updateField('${r.id}', 'dob', this.value)" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800 focus:outline-indigo-500 text-xs">
                        </div>
                        <div>
                            <label class="block font-medium text-slate-500 mb-1">Gender</label>
                            <select onchange="updateField('${r.id}', 'sex', this.value)" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800 focus:outline-indigo-500 text-xs">
                                <option value="M" ${r.sex === 'M' ? 'selected' : ''}>M (Male)</option>
                                <option value="F" ${r.sex === 'F' ? 'selected' : ''}>F (Female)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block font-medium text-slate-500 mb-1">Tanggal Ujian</label>
                            <input type="text" value="${safeTestDate}" onchange="updateField('${r.id}', 'test_date', this.value)" class="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-800 focus:outline-indigo-500 text-xs">
                        </div>
                    </div>

                    <!-- Scores Section -->
                    <div class="mt-5 pt-4 border-t border-slate-200">
                        <div class="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Rincian Komponen Nilai</div>
                        <div class="grid grid-cols-3 gap-3">
                            <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                                <div class="text-xs text-slate-500 mb-1">Listening</div>
                                <input type="number" id="inp-listen-${r.id}" value="${r.listening_score}" onchange="updateScore('${r.id}')" class="w-16 mx-auto text-center font-bold text-base border border-slate-300 rounded px-1 text-slate-900">
                                <div id="cefr-listen-${r.id}" class="mt-1 text-xs font-bold text-indigo-600">CEFR: ${escapeHtml(r.listening_cefr)}</div>
                            </div>
                            <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                                <div class="text-xs text-slate-500 mb-1">Structure</div>
                                <input type="number" id="inp-struct-${r.id}" value="${r.structure_score}" onchange="updateScore('${r.id}')" class="w-16 mx-auto text-center font-bold text-base border border-slate-300 rounded px-1 text-slate-900">
                                <div id="cefr-struct-${r.id}" class="mt-1 text-xs font-bold text-indigo-600">CEFR: ${escapeHtml(r.structure_cefr)}</div>
                            </div>
                            <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                                <div class="text-xs text-slate-500 mb-1">Reading</div>
                                <input type="number" id="inp-read-${r.id}" value="${r.reading_score}" onchange="updateScore('${r.id}')" class="w-16 mx-auto text-center font-bold text-base border border-slate-300 rounded px-1 text-slate-900">
                                <div id="cefr-read-${r.id}" class="mt-1 text-xs font-bold text-indigo-600">CEFR: ${escapeHtml(r.reading_cefr)}</div>
                            </div>
                        </div>

                        <!-- Total Score Card -->
                        <div class="mt-3 bg-indigo-50/70 p-4 rounded-xl border border-indigo-200 flex items-center justify-between">
                            <div>
                                <div class="text-xs font-bold text-indigo-900">TOTAL SCORE</div>
                                <div class="text-xs text-indigo-600">Skor Berskala TOEFL ITP</div>
                            </div>
                            <div class="flex items-center gap-3">
                                <input type="number" id="inp-total-${r.id}" value="${r.total_score}" onchange="updateScore('${r.id}')" class="w-20 text-center font-extrabold text-2xl text-indigo-700 bg-white border border-indigo-300 rounded-lg py-1">
                                <span id="cefr-total-${r.id}" class="px-2.5 py-1 rounded bg-indigo-600 text-white font-bold text-xs">
                                    ${escapeHtml(r.total_cefr)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.appendChild(card);
    });

    // Attach click events for modal previews safely
    document.querySelectorAll('.preview-btn, .preview-img-wrap').forEach(el => {
        el.addEventListener('click', () => {
            const url = el.getAttribute('data-img-url');
            const name = el.getAttribute('data-name');
            openModal(url, name);
        });
    });

    if (window.lucide) { lucide.createIcons(); }
}

async function updateField(id, field, value) {
    await fetch(`/api/reports/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
    });
}

async function updateScore(id) {
    const l = parseInt(document.getElementById(`inp-listen-${id}`).value, 10) || 0;
    const s = parseInt(document.getElementById(`inp-struct-${id}`).value, 10) || 0;
    const r = parseInt(document.getElementById(`inp-read-${id}`).value, 10) || 0;
    const t = parseInt(document.getElementById(`inp-total-${id}`).value, 10) || 0;

    const res = await fetch(`/api/reports/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            listening_score: l,
            structure_score: s,
            reading_score: r,
            total_score: t
        })
    });

    const data = await res.json();
    if (data.report) {
        document.getElementById(`cefr-listen-${id}`).innerText = `CEFR: ${data.report.listening_cefr}`;
        document.getElementById(`cefr-struct-${id}`).innerText = `CEFR: ${data.report.structure_cefr}`;
        document.getElementById(`cefr-read-${id}`).innerText = `CEFR: ${data.report.reading_cefr}`;
        document.getElementById(`cefr-total-${id}`).innerText = data.report.total_cefr;

        const badge = document.getElementById(`badge-status-${id}`);
        if (data.report.is_consistent) {
            badge.className = 'inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200';
            badge.querySelector('.badge-text').innerText = 'Skor Valid';
        } else {
            badge.className = 'inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold border bg-amber-50 text-amber-700 border-amber-200';
            badge.querySelector('.badge-text').innerText = 'Perlu Ditinjau';
        }
    }
}

function openModal(imgUrl, name) {
    document.getElementById('modal-img').src = imgUrl;
    document.getElementById('modal-title').innerText = `Pratinjau Potongan Dokumen: ${name}`;
    document.getElementById('preview-modal').classList.remove('hidden');
    document.getElementById('preview-modal').classList.add('flex');
}

function closeModal() {
    document.getElementById('preview-modal').classList.add('hidden');
    document.getElementById('preview-modal').classList.remove('flex');
}
