# Outline Defense

## Title
Web-Based Question Bank System with Exam Generation, Item Analysis, OMR Scanning, and OBE Attainment Monitoring

## 1. Introduction
- Background of the study
- Problems in manual question banking, exam preparation, item analysis, and OBE documentation
- Need for a centralized system for assessment, reporting, and accreditation support

## 2. Statement of the Problem
- Difficulty managing large question banks
- Time-consuming exam generation
- Manual checking and item analysis delays
- Inconsistent CO/SO mapping
- Lack of real-time OBE attainment monitoring
- Difficulty preparing evidence for accreditation

## 3. Objectives of the Study
- Develop a centralized question bank system
- Allow question upload, parsing, review, and approval
- Generate exams based on subject, topic, difficulty, and outcomes
- Support item analysis through Excel/CSV and OMR scanning
- Compute CO/SO attainment automatically
- Provide OBE dashboards, evidence repository, rubrics, and CQI tracking

## 4. Scope and Limitations
- Covers Super Admin, Admin, Exam Creator, and Exam Requestor roles
- Supports question management, exam generation, item analysis, OMR scanning, and OBE monitoring
- Supports rubric-based assessment and evidence upload
- Limited to the configured subjects, programs, roles, and uploaded data quality
- OBE computation depends on correct CO/SO mapping and linked generated exams

## 5. Review of Related Literature and Systems
- Question bank systems
- Computerized exam generation
- Item analysis and difficulty/discrimination index
- Outcomes-Based Education
- OMR-based assessment processing
- Accreditation evidence management

## 6. Methodology
- Development model: Agile or iterative development
- Technologies used:
  - Node.js and Express.js
  - MongoDB and Mongoose
  - HTML, CSS, and JavaScript
  - ExcelJS for reports and templates
  - OMR scanning support
- Data gathering:
  - Current manual process
  - User requirements
  - OBE and accreditation needs

## 7. System Design
- User roles:
  - Super Admin
  - Admin
  - Exam Creator / Teacher
  - Exam Requestor
- Main modules:
  - Authentication and role access
  - Question bank management
  - Question upload and parser
  - Exam generation
  - Item analysis
  - OMR scanner
  - OBE management
  - Rubric assessment
  - Evidence repository
  - Reports and CQI monitoring

## 8. System Implementation

### 8.1 Environment Setup
- Installed Node.js and required packages
- Set up Express.js server
- Connected the system to MongoDB
- Configured environment variables
- Prepared default administrator account

### 8.2 Database Implementation
- Created database models for:
  - Users
  - Questions
  - Exams
  - Parsed questions
  - Item analysis results
  - OBE settings
  - Course outcomes
  - Student outcomes
  - Program Educational Objectives
  - Rubrics
  - Evidence records
  - CQI plans
- Applied relationships between exams, questions, users, and OBE records

### 8.3 Authentication and Role Access
- Implemented login using JWT
- Added role-based access control
- Created access levels for Super Admin, Admin, Exam Creator, and Exam Requestor
- Restricted pages and APIs based on user roles

### 8.4 Question Bank Module
- Implemented manual question entry
- Added question editing and deletion
- Added CO/SO/Bloom tagging
- Added question difficulty classification
- Added version history for question edits

### 8.5 Question Upload and Parsing
- Implemented file upload for DOCX, PDF, and images
- Extracted questions from uploaded files
- Added parsed question review
- Added approve/reject workflow
- Stored approved questions in the question bank

### 8.6 Exam Generation
- Implemented exam generation based on subject, topic, difficulty, number of items, and CO/SO mapping
- Added generated exam records
- Added DOCX export for exam paper, answer key, and table of specifications

### 8.7 Item Analysis Implementation
- Added Excel/CSV upload for student responses
- Added downloadable item analysis template
- Computed correct count, incorrect count, difficulty index, discrimination index, and item recommendations
- Required generated exam linking for OBE-related item analysis

### 8.8 OMR Scanning Implementation
- Generated OMR answer sheet template
- Added mobile scanner interface
- Processed scanned student answers
- Saved scanned results to item analysis records

### 8.9 OBE Management Implementation
- Implemented PEO, SO, and CO/CLO management
- Added curriculum map
- Added OBE attainment settings
- Computed CO/SO/Bloom attainment from linked item analysis
- Added live attainment monitoring
- Added teacher OBE dashboard

### 8.10 Rubric-Based Assessment
- Added rubric model and upload template
- Allowed rubric score import from Excel
- Mapped rubric criteria to CO/SO/Bloom
- Included rubric scores in OBE attainment

### 8.11 Evidence Repository
- Added evidence upload and storage
- Allowed teachers to submit OBE evidence
- Allowed Super Admin to monitor evidence records
- Linked evidence to subjects and outcomes

### 8.12 CQI Monitoring
- Added CQI intervention plans for not-attained outcomes
- Added root cause, intervention, target date, evidence, and verification fields
- Tracked CQI status from planned to verified

### 8.13 Reports and Export
- Implemented reports dashboard
- Added activity logs
- Added accreditation OBE report export
- Added Excel export for item analysis and OBE data

## 9. System Features
- User account management
- Question upload and parsing
- Manual question encoding
- Question approval workflow
- Randomized exam generation
- DOCX exam and answer key download
- Excel/CSV item analysis upload
- OMR answer sheet generation and scanning
- Automatic difficulty and discrimination analysis
- CO/SO/Bloom attainment computation
- Teacher OBE dashboard
- Super Admin OBE monitoring
- Rubric Excel upload
- Evidence repository
- Historical attainment snapshots
- CQI intervention plans

## 10. OBE Workflow
```text
Question is mapped to CO/SO/Bloom
-> Exam is generated
-> Teacher uploads item analysis linked to the generated exam
-> System computes attainment
-> Super Admin monitors OBE dashboard
-> CQI plan is created if an outcome is not attained
-> Evidence is stored for accreditation
```

## 11. Testing and Evaluation
- Functional testing
- Role-based access testing
- Upload and parser testing
- Exam generation testing
- Item analysis computation testing
- OBE attainment validation
- OMR scanning accuracy testing
- User acceptance testing

## 12. Results
- Faster exam generation
- Centralized question storage
- Reduced manual item analysis work
- Automatic OBE attainment reports
- Improved evidence preparation
- Better tracking of weak outcomes and CQI needs

## 13. Conclusion
- The system successfully supports question banking, exam generation, item analysis, OMR scanning, and OBE monitoring.
- It helps teachers and administrators manage assessment data more efficiently.
- It strengthens accreditation readiness through automated reports, evidence tracking, and CQI monitoring.

## 14. Recommendations
- Add LMS integration
- Add advanced analytics
- Improve AI-assisted CO/SO mapping
- Add mobile offline sync for OMR
- Add more customizable accreditation report formats
- Conduct wider deployment testing with real users

## 15. Demo Flow
1. Login as Super Admin
2. Show dashboard and users
3. Show question bank
4. Upload or add questions
5. Map questions to CO/SO
6. Generate exam
7. Login as teacher or exam requestor
8. Upload item analysis linked to generated exam
9. Show automatic item analysis result
10. Show OBE Management and Live Attainment
11. Show rubric upload
12. Show evidence repository
13. Show reports and export

## Short Defense Script
During implementation, the system was developed module by module. I first set up the backend server, database connection, and authentication. Then I implemented the question bank, upload parser, exam generation, item analysis, and OMR scanner. After that, I integrated the OBE module by mapping questions to CO and SO, computing attainment from linked item analysis, adding rubric-based assessment, evidence repository, CQI monitoring, and report generation. Finally, I tested the system based on user roles and workflows to ensure that teacher submissions are reflected in the Super Admin OBE dashboard.
