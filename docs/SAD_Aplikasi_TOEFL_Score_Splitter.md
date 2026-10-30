# Software Architecture Document (SAD)
## Sistem Otomasi Pemisahan, Ekstraksi Data & Distribusi TOEFL ITP Score Report
**Project Codename:** `TOEFL-ScoreSplitter`  
**Versi Dokumen:** 1.0  
**Tanggal:** 30 Oktober 2026  
**Status:** Architecture Baseline (Approved for Development)  

---

## 1. Pendahuluan & Sasaran Arsitektur

### 1.1 Tujuan Dokumen
Dokumen ini mendefinisikan arsitektur sistem tingkat tinggi dan mendalam untuk aplikasi `TOEFL-ScoreSplitter`. Dokumen ini menjadi rujukan teknis utama bagi tim pengembang perangkat lunak, DevOps, dan QA dalam mengimplementasikan, menguji, dan memelihara sistem.

### 1.2 Sasaran Arsitektur (Architectural Goals)
1. **Akurasi Pemotongan Deterministik:** Memastikan segmentasi 3 bagian pada lembar laporan TOEFL ITP konsisten dengan batas toleransi kesalahan vertikal $\le 2$ piksel.
2. **Performa Pemrosesan Cepat:** Waktu end-to-end (unggah $\to$ pra-pemrosesan citra $\to$ pemotongan 3 bagian $\to$ OCR $\to$ hasil siap ditinjau) $\le 3$ detik per halaman A4.
3. **Isolasi Privasi Data Siswa:** Memastikan data dan berkas potongan peserta tidak bocor antarpeserta (sesuai UU Perlindungan Data Pribadi / UU PDP).
4. **Resiliensi & Penanganan Error Cerdas:** Memiliki *fallback mechanism* jika pemindaian miring (*skewed*), kontras rendah, atau resolusi non-standar.
5. **Kemudahan Deployment:** Bersifat modular (*container-ready* via Docker), dapat dijalankan secara lokal (on-premise) tanpa ketergantungan internet wajib, maupun di-deploy pada server cloud/VPS.

---

## 2. Gambaran Sistem C4 Model

### 2.1 C4 Level 1: System Context Diagram

```mermaid
flowchart TD
    Admin["Staf Admin / Operator Institusi"] -->|Unggah Scan Batch, Validasi Data, Unduh Hasil| App["TOEFL-ScoreSplitter System"]
    
    App -->|Arsip ZIP & Rekap Excel| Admin
    App -->|Kirim Sertifikat Personal PDF/JPG| Student["Peserta Ujian (Examinee)"]
    App -.->|Opsi Cloud OCR API| CloudOCR["Google Cloud Vision / Gemini API (Fallback)"]
    App -.->|Opsi Notifikasi Pengiriman| WAGateway["WhatsApp Gateway / SMTP Server"]
```

---

### 2.2 C4 Level 2: Container Diagram (Struktur Kontainer & Layanan)

```mermaid
flowchart TB
    subgraph ClientBrowser["Client Layer (Web Browser)"]
        SPA["Frontend SPA (React 19 / Next.js)<br/>- Tailwind CSS & Shadcn UI<br/>- Canvas Interactive Splitter<br/>- Side-by-side Verification Form"]
    end

    subgraph BackendApp["Application & Worker Layer"]
        Gateway["API Gateway / FastAPI Core<br/>- Authentication & Session<br/>- Batch Upload Handler<br/>- REST Endpoints"]
        
        Queue["Task Queue & Broker<br/>(Celery / Redis / BullMQ)"]
        
        WorkerCV["Worker 1: Computer Vision Engine<br/>- PyMuPDF (PDF rasterization)<br/>- OpenCV (Deskew, Line Detect, Crop)<br/>- High-Quality Canvas Resizer"]
        
        WorkerOCR["Worker 2: Extraction & OCR Engine<br/>- Tesseract 5 / PaddleOCR Engine<br/>- Regex & Score Validation Heuristic<br/>- CEFR Level Mapper"]
        
        Packager["Worker 3: Generator & Exporter<br/>- Standalone PDF Builder<br/>- OpenPyXL (Excel Generator)<br/>- ZIP Stream Packager"]
    end

    subgraph DataStorage["Data & Storage Layer"]
        DB[("Database PostgreSQL<br/>- Batch Metadata<br/>- Examinee Records & Scores<br/>- Audit Logs")]
        BlobStore[("Object / Local Storage<br/>- Original Scans<br/>- Cropped JPEGs & PDFs<br/>- Export ZIPs")]
    end

    SPA -->|HTTPS / REST API / SSE| Gateway
    Gateway -->|Enqueue Processing Job| Queue
    Queue --> WorkerCV
    WorkerCV --> WorkerOCR
    WorkerOCR --> Packager
    
    Gateway -->|Query / Update| DB
    WorkerOCR -->|Simpan Hasil Ekstraksi| DB
    WorkerCV -->|Baca & Simpan Potongan| BlobStore
    Packager -->|Simpan ZIP & Excel| BlobStore
    Gateway -->|Stream Download| BlobStore
```

---

### 2.3 C4 Level 3: Component Diagram (Pipeline Pemrosesan Citra & OCR)

```mermaid
flowchart LR
    A["Raw Input (PDF / Scan Image)"] --> B["1. Rasterizer & Ingestion<br/>(Extract 200/300 DPI RGB)"]
    B --> C["2. Preprocessing & Auto-Deskew<br/>(Hough Lines & Projection)"]
    C --> D["3. Boundary Anchor Detection<br/>(Find 3x Title & Separator Lines)"]
    D --> E["4. Smart Cropper & Padding<br/>(Generate Part 1, 2, 3 + White Margins)"]
    E --> F["5. OCR Zone Segmentation<br/>(BBox Extraction: Name, ID, Scores)"]
    F --> G["6. Heuristic Validation Engine<br/>(Score Checksum & CEFR Mapping)"]
    G --> H["7. Structured JSON & Clean Artifacts"]
```

---

## 3. Desain Algoritma Inti (Core Algorithms)

### 3.1 Algoritma Auto-Deskewing (Koreksi Kemiringan Scan)
Jika scanner menarik kertas secara miring, koordinat potong horizontal akan berantakan. Sistem menggunakan deteksi garis kontur OpenCV:
```python
def correct_skew(image_cv):
    gray = cv2.cvtColor(image_cv, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLines(edges, 1, np.pi / 180, 200)
    
    angles = []
    if lines is not None:
        for rho, theta in lines[:, 0]:
            angle = (theta * 180 / np.pi) - 90
            if abs(angle) < 15:  # Batasi kemiringan maksimal 15 derajat
                angles.append(angle)
                
    if angles:
        median_angle = np.median(angles)
        (h, w) = image_cv.shape[:2]
        center = (w // 2, h // 2)
        M = cv2.getRotationMatrix2D(center, median_angle, 1.0)
        return cv2.warpAffine(image_cv, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return image_cv
```

### 3.2 Algoritma Segmentasi 3 Bagian Dinamis (Horizontal Anchor Profiling)
Format TOEFL ITP standar memiliki 3 blok yang diawali frasa `"TOEFL ITP Score Report"` dan garis horizontal gelap.
1. **Deteksi Proyeksi Baris Horisontal (*Horizontal Projection Profile*):**
   * Hitung intensitas piksel rata-rata per baris $Y$.
   * Garis pembatas horizontal memiliki intensitas rata-rata jauh lebih gelap ($\text{brightness} < 210$).
2. **Pola Koordinat Baku:**
   * Garis 1 ($L_1$): Sekitar $Y \approx 195\text{px}$ (Part 1).
   * Garis 2 ($L_2$): Sekitar $Y \approx 925\text{px}$ (Part 2).
   * Garis 3 ($L_3$): Sekitar $Y \approx 1645\text{px}$ (Part 3).
3. **Titik Potong Aman (Safe Cutpoints):**
   * $\text{Cut}_0 = \max(0, L_1 - 160)$ (Menyisakan margin atas judul).
   * $\text{Cut}_1 = \frac{\text{Bottom}_1 + L_2 - 80}{2} \approx 780\text{px}$ (Pusat area putih antar-bagian).
   * $\text{Cut}_2 = \frac{\text{Bottom}_2 + L_3 - 80}{2} \approx 1520\text{px}$ (Pusat area putih kedua).
   * $\text{Cut}_3 = \text{Batas sebelum bayangan scanner bed} \approx 2195\text{px}$.
4. **Normalisasi Dimensi Seragam:**
   Setiap bagian dirender ke kanvas berdimensi sama ($1653 \times 750\text{px}$ pada 200 DPI) dengan latar belakang putih murni (`#FFFFFF`).

### 3.3 Validasi Nilai & Integritas Data (Checksum Formula)
ETS menerapkan formula penskalaan nilai komponen ke total skor. Sistem memvalidasi apakah angka hasil OCR konsisten:
$$\text{Calculated Total} = \text{round}\left( \frac{\text{Listening} + \text{Structure} + \text{Reading}}{3} \times 10 \right)$$
* Jika $|\text{Total OCR} - \text{Calculated Total}| \le 2$: **Status VALID (Green)**.
* Jika selisih $> 2$: **Status WARNING (Amber)** $\to$ Ditandai di UI agar admin meninjau ulang.

---

## 4. Skema Basis Data (Database Schema)

Sistem menggunakan basis data relasional PostgreSQL dengan ekstensi UUID.

```mermaid
erDiagram
    BATCHES ||--o{ DOCUMENTS : contains
    DOCUMENTS ||--o{ EXAMINEE_REPORTS : produces
    EXAMINEE_REPORTS ||--o{ AUDIT_LOGS : tracks

    BATCHES {
        uuid id PK
        varchar batch_name
        timestamp created_at
        varchar status "PENDING, PROCESSING, COMPLETED, FAILED"
        int total_pages
        int total_reports
    }

    DOCUMENTS {
        uuid id PK
        uuid batch_id FK
        int page_number
        varchar original_file_path
        boolean is_skew_corrected
        float detected_skew_angle
    }

    EXAMINEE_REPORTS {
        uuid id PK
        uuid document_id FK
        int part_position "1, 2, or 3"
        varchar student_number
        varchar student_name
        date dob
        varchar sex "M / F"
        varchar institution_name
        date test_date
        varchar form_type
        int listening_score
        varchar listening_cefr
        int structure_score
        varchar structure_cefr
        int reading_score
        varchar reading_cefr
        int total_score
        boolean is_score_consistent
        varchar cropped_image_path
        varchar single_pdf_path
        varchar review_status "AUTO_APPROVED, REVIEWED, MODIFIED"
    }

    AUDIT_LOGS {
        uuid id PK
        uuid report_id FK
        varchar modified_by
        varchar field_name
        varchar old_value
        varchar new_value
        timestamp modified_at
    }
```

---

## 5. Spesifikasi REST API

### 5.1 Batch Upload & Ingestion
```http
POST /api/v1/batches/upload
Content-Type: multipart/form-data
```
* **Payload:** `files: [File, File...]` (Mendukung PDF multi-halaman atau berkas gambar).
* **Response (202 Accepted):**
```json
{
  "batch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status": "PROCESSING",
  "total_files": 1,
  "estimated_time_seconds": 3
}
```

### 5.2 Real-Time Batch Status & Progress
```http
GET /api/v1/batches/{batch_id}/status
```
* **Response (200 OK):**
```json
{
  "batch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status": "COMPLETED",
  "progress_percentage": 100,
  "processed_pages": 1,
  "total_reports_extracted": 3
}
```

### 5.3 Pengambilan Hasil Ekstraksi & Laporan
```http
GET /api/v1/batches/{batch_id}/reports
```
* **Response (200 OK):**
```json
{
  "batch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "reports": [
    {
      "id": "e4c8ed8c-c502-49f1-abaa-b16984f124a3",
      "part": 1,
      "student_number": "040919269110005",
      "student_name": "AL FATIH, KIANO MUHAMMAD",
      "dob": "2011-09-05",
      "sex": "M",
      "test_date": "2026-09-19",
      "scores": {
        "listening": { "scaled": 53, "cefr": "B1" },
        "structure": { "scaled": 49, "cefr": "B1" },
        "reading": { "scaled": 47, "cefr": "B1" },
        "total": 497
      },
      "is_valid": true,
      "image_url": "/api/v1/assets/images/part1.jpg",
      "pdf_url": "/api/v1/assets/pdfs/part1.pdf"
    }
  ]
}
```

### 5.4 Pembaruan Koreksi Manual (Human-in-the-Loop)
```http
PUT /api/v1/reports/{report_id}
Content-Type: application/json
```
* **Payload:**
```json
{
  "student_name": "AL FATIH, KIANO MUHAMMAD",
  "total_score": 497,
  "verified_by": "admin_chandra"
}
```

### 5.5 Ekspor Paket Unduhan
```http
GET /api/v1/batches/{batch_id}/export?format=zip
```
* **Response:** Stream file biner `TOEFL_ITP_Batch_[date].zip` berisi:
  * `/PDFs/[No]_[StudentNumber]_[NamaPeserta].pdf`
  * `/JPGs/[No]_[StudentNumber]_[NamaPeserta].jpg`
  * `Rekap_Nilai_TOEFL_ITP_[date].xlsx`

---

## 6. Desain Antarmuka Pengguna (UI/UX Design)

```
+----------------------------------------------------------------------------------------------------+
|  TOEFL-ScoreSplitter Pro Dashboard                      [Batch #202609-01]  [Export All ZIP] [XLS] |
+----------------------------------------------------------------------------------------------------+
|  [Upload PDF/Scans] -> 1 Page Processed -> 3 Examinees Found                                       |
+--------------------------------------------------+-------------------------------------------------+
|  PANEL KIRI: PREVIEW POTONGAN DOKUMEN            |  PANEL KANAN: FORMULIR VALIDASI OCR             |
+--------------------------------------------------+-------------------------------------------------+
|  +--------------------------------------------+  |  Peserta 1 dari 3:                              |
|  | TOEFL ITP Score Report                     |  |  ---------------------------------------------  |
|  | Name: AL FATIH, KIANO MUHAMMAD             |  |  Nama Siswa     : [ AL FATIH, KIANO MUHAMMAD  ] |
|  | Student No: 040919269110005                |  |  Student Number : [ 040919269110005           ] |
|  | DOB: 05 Sep 2011   Sex: M                  |  |  Tanggal Lahir  : [ 05/09/2011  ]  Gender: [M ] |
|  | Scaled Scores:                             |  |  Tanggal Ujian  : [ 19/09/2026  ]               |
|  | Listening: 53  Structure: 49  Reading: 47  |  |  ---------------------------------------------  |
|  | Total Score: 497                           |  |  Listening      : [ 53 ]  CEFR: [ B1 ]          |
|  +--------------------------------------------+  |  Structure      : [ 49 ]  CEFR: [ B1 ]          |
|  [ Adjust Crop Divider Handles ]                 |  Reading        : [ 47 ]  CEFR: [ B1 ]          |
|                                                  |  TOTAL SCORE    : [ 497 ] [✓ Checksum Match]    |
|  Status: [✓ Auto-Approved]                       |  ---------------------------------------------  |
|  [ Unduh PDF Pribadi ] [ Unduh JPG ]             |  [ Save & Next Participant ] [ Confirm All ]    |
+--------------------------------------------------+-------------------------------------------------+
```

---

## 7. Keamanan, Kepatuhan & Privasi Data

1. **Privasi Siswa (UU PDP Compliance):**
   * Berkas hasil potong hanya dapat diunduh per ID peserta yang valid.
   * File lembar pindaian master 3-peserta tidak boleh disebarkan ke publik/siswa.
2. **Enkripsi Data:**
   * Seluruh data yang disimpan (*at-rest*) di PostgreSQL dienkripsi dengan standar AES-256.
   * Komunikasi antarperamban dan server wajib menggunakan TLS 1.3 (HTTPS).
3. **Kebijakan Retensi Berkas (Auto-Purge Lifecycle):**
   * Berkas citra sementara dan arsip ZIP di penyimpanan lokal/cloud akan dihapus secara terjadwal setelah **30 hari** melalui cron job pembersih otomatis (`cleanup_old_batches`).
   * Hanya metadata skor dan riwayat log yang disimpan permanen di database.

---

## 8. Panduan Deployment (Dockerized Environment)

Aplikasi dipaketkan ke dalam arsitektur multi-container yang siap dijalankan dengan 1 perintah:
```bash
docker compose up -d --build
```

### File `docker-compose.yml`:
```yaml
version: '3.8'

services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
    depends_on:
      - backend

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://toefl_user:toefl_pass@postgres:5432/toefl_db
      - REDIS_URL=redis://redis:6379/0
      - STORAGE_PATH=/app/storage
    volumes:
      - toefl_storage:/app/storage
    depends_on:
      - postgres
      - redis

  worker:
    build: ./backend
    command: celery -A worker.celery_app worker --loglevel=info -c 4
    environment:
      - DATABASE_URL=postgresql://toefl_user:toefl_pass@postgres:5432/toefl_db
      - REDIS_URL=redis://redis:6379/0
      - STORAGE_PATH=/app/storage
    volumes:
      - toefl_storage:/app/storage
    depends_on:
      - backend
      - redis

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=toefl_user
      - POSTGRES_PASSWORD=toefl_pass
      - POSTGRES_DB=toefl_db
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  toefl_storage:
  pgdata:
```
