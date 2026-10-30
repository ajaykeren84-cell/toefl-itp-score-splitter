const XLSX = require('xlsx');

function generateExcelReport(reports, outPath) {
    const data = reports.map((r, idx) => ({
        'No': idx + 1,
        'Student Number': r.student_number || '',
        'Nama Peserta': r.student_name || '',
        'DOB': r.dob || '',
        'Gender': r.sex || '',
        'Institusi': r.institution_name || '',
        'Tanggal Tes': r.test_date || '',
        'Form Tes': r.form_type || 'TOEFL ITP Level 1',
        'Listening Score': r.listening_score || 0,
        'Listening CEFR': r.listening_cefr || '',
        'Structure Score': r.structure_score || 0,
        'Structure CEFR': r.structure_cefr || '',
        'Reading Score': r.reading_score || 0,
        'Reading CEFR': r.reading_cefr || '',
        'Total Score': r.total_score || 0,
        'Total CEFR': r.total_cefr || '',
        'Validasi Nilai': r.is_consistent ? 'VALID' : 'PERLU REVIEW',
        'Nama File PDF': r.pdf_filename || '',
        'Nama File JPG': r.jpg_filename || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
        { wch: 5 },  // No
        { wch: 20 }, // Student Number
        { wch: 30 }, // Nama
        { wch: 14 }, // DOB
        { wch: 8 },  // Gender
        { wch: 30 }, // Institusi
        { wch: 14 }, // Tanggal Tes
        { wch: 20 }, // Form
        { wch: 15 }, // Listening
        { wch: 14 }, // L CEFR
        { wch: 15 }, // Structure
        { wch: 14 }, // S CEFR
        { wch: 15 }, // Reading
        { wch: 14 }, // R CEFR
        { wch: 12 }, // Total
        { wch: 12 }, // T CEFR
        { wch: 15 }, // Validasi
        { wch: 35 }, // File PDF
        { wch: 35 }  // File JPG
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rekap Nilai TOEFL ITP');
    XLSX.writeFile(wb, outPath);

    return outPath;
}

module.exports = {
    generateExcelReport
};
