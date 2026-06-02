# Question Bank System User Guide

## Introduction

The Question Bank System is a web-based application for creating, uploading, reviewing, approving, managing, and generating exams from a centralized question bank.

The system supports:

- Administrator-created user accounts and login
- Dashboard monitoring
- Manual question entry
- DOCX/PDF/image questionnaire upload
- Automatic parsing of multiple-choice questions
- DOCX table parsing for tables placed between the question text and choices
- Review and approval of parsed questions
- Bulk approval and rejection of parsed questions
- Question management
- Randomized exam generation
- DOCX download for exam papers and answer keys
- Item analysis upload from Excel or CSV student results
- Item analysis reports and Excel export

## Email and Administrator Setup

Configure these environment variables before production use so the system can send password reset and system emails:

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@example.com
SMTP_PASS=your_email_password_or_app_password
SMTP_FROM="Question Bank <your_email@example.com>"
```

If SMTP settings are not configured, email-based features may not send messages correctly in production.

The default administrator account can also be prepared through environment variables:

```text
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_secure_admin_password
ADMIN_NAME=System Administrator
```

## 1. Account Creation

### Public Registration

Public self-registration is disabled. Users cannot create accounts from the login page.

Accounts are created by an administrator from the `Users` page.

### How an Admin Creates an Account

1. Log in as an administrator.
2. Go to `Users`.
3. In the `Create Account` form, enter the user's full name.
4. Enter the user's email address.
5. Enter a temporary password.
6. Select the user's role.
7. Click `Create Account`.

### Required Fields

- Full Name
- Email
- Password

### Role Selection

The administrator selects the account role during creation. The system supports `user`, `professor`, `student`, `admin`, and `super_admin` roles.

### After Successful Account Creation

After successful account creation:

1. The account is saved in the database.
2. The account is marked as verified.
3. The user can log in using the email and password assigned by the administrator.
4. The user's access depends on the selected role.

### Common Account Creation Errors

| Error | Cause | Fix |
| --- | --- | --- |
| Name, email, and password are required | One or more required fields were left blank | Complete all required fields |
| Email already registered | The email is already used by another account | Use a different email or log in with the existing account |
| Role must be user, professor, student, admin, or super admin | The selected role is not supported | Choose one of the supported roles |
| Invalid email format | The email address is not valid | Enter a valid email address |
| Server error | Temporary server or database issue | Try again or contact the administrator |

## 2. Login Process

### How to Login

1. Open the login page.
2. Enter your registered email address.
3. Enter your password.
4. Click `Login`.

### Required Fields

- Email
- Password

### After Successful Login

After successful login:

1. The system verifies your email and password.
2. A login session token is saved in the browser.
3. You are redirected to the appropriate system page.
4. Your access depends on your role.

Admin-created accounts are already marked as verified and can log in immediately.

### If Login Fails

If login fails:

1. Check that the email address is correct.
2. Check that the password is correct.
3. Make sure the account already exists.
4. Try logging in again.
5. If the problem continues, contact the administrator.

Common login error:

```text
Invalid email or password.
```

```text
Please verify your email before logging in.
```

## 3. Dashboard Overview

The dashboard gives administrators a quick summary of system activity.

Regular users have a separate `My Dashboard` page. It shows their generated exams, completed exams, pending exams, average score, recent exam activity, and quick links to generate an exam or browse questions.

### Main Dashboard Sections

1. `Total Users`
   Shows the number of registered users.

2. `Total Questions`
   Shows the number of saved questions in the question bank.

3. `Easy`
   Shows the number of questions classified as Easy.

4. `Difficult`
   Shows the number of questions classified as Difficult.

5. `Recent Questions`
   Shows recently added questions.

6. `Recent Exams`
   Shows recently generated exams.

7. `Registered Users`
   Shows registered user information.

### Navigation Menu

The sidebar menu provides access to the main system pages:

- `Dashboard`: View system summaries and recent activity.
- `Questions`: View, filter, edit, or delete saved questions.
- `Add Question`: Manually add a single question.
- `Upload Questionnaire`: Upload a DOCX, PDF, or image file for parsing.
- `Review Parsed Questions`: Review questions extracted from uploaded files.
- `Generate Exam`: Create a randomized exam from approved/saved questions.
- `Item Analysis`: Upload student results and generate item analysis reports.
- `Profile`: View profile details, generated exams, and download generated exam files.
- `Users`: Manage user roles and accounts. Admin access only.
- `Reports`: View system reports and activity. Admin access only.
- `Logout`: End the current session.

### User Roles

The system currently supports these roles:

| Role | Description |
| --- | --- |
| user | Regular teacher/professor-style account. Can generate exams and access allowed user features. |
| professor | Teacher account. Can generate exams and access item analysis tools. |
| student | Student account. Has limited access and cannot access teacher/admin tools such as upload, exam generation, or item analysis upload. |
| admin | Administrator account. Can upload questionnaires, review parsed questions, approve/reject questions, manage questions, manage users, view reports, generate exams, and access item analysis. |
| super_admin | Highest administrator account. Has admin-level access and can also retain protected administrative privileges. |

## 4. Uploading Questions

### Where to Upload a DOCX File

1. Log in as an admin.
2. Go to `Upload Questionnaire`.
3. Click the file input.
4. Select the DOCX file from your computer.
5. Click `Upload File`.

### Required File Type

The upload tool accepts:

- `.docx`
- `.pdf`
- `.jpg`
- `.jpeg`
- `.png`
- `.webp`

For best results, use `.docx` with plain text formatting.

### After Upload

After upload:

1. The file appears in the uploaded files list.
2. Enter the subject.
3. Enter the topic.
4. Click `Parse Questions`.
5. The system extracts the question text, choices, and images when possible.
6. Parsed questions are saved as pending review items.

### How Parsed Questions Are Displayed

Parsed questions appear on the `Review Parsed Questions` page. Each parsed question can show:

- A selection checkbox for bulk approval or rejection
- Subject
- Topic
- Attached image, if detected
- Attached table, if detected
- Question text
- Choices A, B, C, and D
- Correct answer field
- Difficulty
- Explanation
- Action buttons

### How to Review Questions After Upload

1. Go to `Review Parsed Questions`.
2. Check each parsed question.
3. Confirm the question text is correct.
4. Confirm all choices are complete.
5. Confirm the image is attached to the correct question.
6. Edit any incorrect fields.
7. Save the edit.
8. Approve or reject the parsed question.

### Bulk Review Actions

The `Review Parsed Questions` page supports bulk actions for visible pending questions.

To approve or reject multiple parsed questions:

1. Go to `Review Parsed Questions`.
2. Use the search box if you want to narrow the visible list.
3. Check the selection box on each parsed question you want to include.
4. Or click `Select visible` to select all currently visible parsed questions.
5. Click `Approve Selected` or `Reject Selected`.

For bulk approval, every selected question must have:

- Complete choices A, B, C, and D
- A selected correct answer

If one or more selected questions are incomplete, the system shows an error and does not approve that group until the missing information is fixed.

## 5. Rules for Making DOCX Files Parsable

Use a simple, consistent multiple-choice format.

### Question Format

```text
1. Question text here
```

### Choices Format

```text
a. First choice
b. Second choice
c. Third choice
d. Fourth choice
```

The parser can also detect uppercase choices such as `A.`, `B.`, `C.`, and `D.`, but lowercase choices are recommended for consistency.

### Example

```text
1. Find the area bounded by the curve y = 9 - x² and the x-axis.

a. 36 unit²
b. 35 unit²
c. 34 unit²
d. 33 unit²
```

Optional answer format:

```text
Answer: A
```

If the answer is not included, the admin can select the correct answer during review.

### Supported DOCX Table Format

The system can parse a DOCX table when the table appears after the question text and before the choices.

Use this order:

```text
1. Given the following production data table, determine the total material cost.

[DOCX TABLE HERE]
Material | Quantity | Unit Cost
Cement   | 20       | 280
Sand     | 5        | 1500
Gravel   | 8        | 1200

a. 15,600
b. 16,000
c. 16,600
d. 17,200

Answer: C
```

The table must be a real Word table, not a screenshot of a table.

## 6. Parsing Rules

Follow these rules to improve parsing accuracy:

1. Use numbered questions: `1.`, `2.`, `3.`
2. Use lowercase choices: `a.`, `b.`, `c.`, `d.`
3. Put each question on its own line.
4. Put each choice on its own line.
5. If a question has a table, place the table after the question text and before the choices.
6. Use real DOCX tables, not screenshots of tables.
7. Keep tables simple and readable.
8. Use 2 or more columns for tables.
9. Avoid using table rows as answer choices.
10. Avoid putting the question number inside a table cell.
11. Avoid text boxes.
12. Avoid SmartArt.
13. Avoid heavily merged cells.
14. Avoid complicated formatting.
15. Use plain text as much as possible.
16. Images must be placed directly below or near the related question.
17. Do not put multiple questions inside one paragraph.
18. Do not use screenshots as question text.
19. Mathematical expressions should be typed clearly.
20. Use `x²` instead of `x2` when possible.
21. Use `a²y = x³` instead of `a2 y = x3` when possible.

## 7. Uploading Questions with Images

### Image Placement Rules

1. Place the image under the specific question it belongs to.
2. Keep the image near the related question text.
3. Make the image inline with text.
4. Do not use floating images.
5. Use one image per question when possible.
6. Avoid overlapping images.
7. Use clear, readable images.
8. Resize images before uploading if they are too large.

### Recommended Image Setup in DOCX

1. Click the image in Word.
2. Set the image layout to `In Line with Text`.
3. Place it directly after the related question.
4. Put the choices below the image.

Example:

```text
1. Refer to the figure below. Find the value of x.

[Insert image here, inline with text]

a. 10
b. 20
c. 30
d. 40
```

### Important Image Note

If a DOCX contains the same number of embedded images as parsed questions, the system attaches the images by order:

- Image 1 goes to Question 1
- Image 2 goes to Question 2
- Image 3 goes to Question 3

If the number of images and questions does not match, use clear wording such as `refer to the figure below` or `see figure` near the question.

## 8. Uploading Questions with Tables

The system supports DOCX tables when they are part of the problem statement.

### Table Placement Rules

1. Place the table directly below the related question text.
2. Place the choices after the table.
3. Use a real Word table.
4. Do not use an image or screenshot of a table.
5. Do not place the question number inside the table.
6. Do not place choices inside the table.
7. Keep the table simple.
8. Use clear column headers when possible.
9. Avoid fully empty rows.
10. Avoid complicated merged cells.

### Correct Table Layout

```text
1. Given the following production data table, determine the total material cost.

[DOCX TABLE]
Material | Quantity | Unit Cost
Cement   | 20       | 280
Sand     | 5        | 1500
Gravel   | 8        | 1200

a. 15,600
b. 16,000
c. 16,600
d. 17,200
```

### Incorrect Table Layout

Avoid putting the choices inside the table:

```text
1. Given the following production data table, determine the total material cost.

[DOCX TABLE]
a. 15,600 | b. 16,000
c. 16,600 | d. 17,200
```

Avoid putting multiple questions inside one table:

```text
[DOCX TABLE]
1. Question text | a. Choice | b. Choice
2. Question text | a. Choice | b. Choice
```

## 9. Reviewing Parsed Questions

### Check Question Text

1. Go to `Review Parsed Questions`.
2. Read the question text carefully.
3. Check for missing words, merged lines, or incorrect symbols.
4. Edit the text if needed.
5. Click `Save Edit`.

### Check Choices

For every parsed question, confirm:

- Choice A is complete.
- Choice B is complete.
- Choice C is complete.
- Choice D is complete.
- No choice contains text from another choice.
- The correct answer is selected.

### Verify Images

For image-based questions:

1. Make sure an image is visible.
2. Confirm the image belongs to the displayed question.
3. Check that the image is not blurry or cut off.
4. If the wrong image is attached, reject the parsed question and correct the source DOCX before uploading again.

### Verify Tables

For table-based questions:

1. Make sure the table appears below the question text.
2. Confirm the table appears before the choices.
3. Check that rows and columns are in the correct order.
4. Check that table cell text is readable.
5. If the table is missing or wrong, reject the parsed question and correct the source DOCX before uploading again.

### Edit Wrong Parsed Questions

1. Update the subject or topic if needed.
2. Edit the question text.
3. Edit choices A to D.
4. Select the correct answer.
5. Select the correct difficulty.
6. Add or update explanation.
7. Click `Save Edit`.

### Delete or Remove Incorrect Questions

Incorrect parsed questions can be removed by clicking `Reject`. Rejecting a parsed question deletes it from the parsed-question database collection.

Saved questions in the question bank can be managed from the `Questions` page.

## 10. Approval Workflow

The system uses an approval workflow for parsed questions.

### Pending Questions

After parsing, questions are saved as `Pending`. Pending questions are not yet final question-bank items.

### Admin Review

An admin should review each pending question before approval:

1. Confirm subject and topic.
2. Confirm the question text.
3. Confirm all choices.
4. Confirm the correct answer.
5. Confirm difficulty.
6. Confirm image placement.
7. Confirm table placement and table content if the question has a table.
8. Save edits if needed.

### Approve Questions

Click `Approve to Question Bank` to save the parsed question into the main question bank.

To approve multiple visible questions at once:

1. Select the questions.
2. Confirm all selected questions have complete choices and a correct answer.
3. Click `Approve Selected`.

The system saves the current edits for each selected question before approving it.

### Reject Questions

Click `Reject` if the question is incorrect, incomplete, duplicated, or should not be added.

To reject multiple visible questions at once:

1. Select the questions.
2. Click `Reject Selected`.

Rejected questions are deleted from the parsed-question database collection and removed from the pending review list.

### Approved Questions and Exam Generation

Only questions saved in the question bank are available for exam generation. Pending or rejected parsed questions should not be treated as final exam-ready questions.

## 11. Exam Generation

### How to Generate an Exam

1. Go to `Generate Exam`.
2. Enter an exam title.
3. Enter the subject.
4. Enter the topic if needed.
5. Enter the total number of items.
6. Enter how many Easy questions to include.
7. Enter how many Average questions to include.
8. Enter how many Difficult questions to include.
9. Click `Generate Exam`.

### Difficulty Distribution

The total number of items must equal:

```text
Easy count + Average count + Difficult count
```

Example:

```text
Total Items: 20
Easy: 5
Average: 10
Difficult: 5
```

### Randomized Question Selection

The system randomly selects questions based on:

- Subject
- Topic, if provided
- Difficulty
- Requested number of items

If there are not enough questions for the selected distribution, the system shows an error.

### Downloading Exam Files

After generating an exam, the take-exam page provides two DOCX downloads:

1. `Download No Answer`
   Downloads the exam paper without answers.

2. `Download Answer Key`
   Downloads a separate answer key file with correct answers and explanations when available.

PDF export is not currently shown as a supported download option in the system interface.

Tables included in questions appear below the question text and before the choices in the exam view and generated DOCX files.

## 12. Item Analysis

Item analysis helps teachers review student performance per item after an exam.

### Who Can Access Item Analysis

Item analysis is available to:

- `admin`
- `super_admin`
- `professor`
- `user`

Student accounts cannot access the item analysis upload page.

### How to Upload Item Analysis Results

1. Go to `Item Analysis`.
2. Enter the exam title.
3. Enter the subject.
4. Enter the section.
5. Optionally enter the semester and school year.
6. Enter the number of items.
7. Upload the Excel or CSV result file.
8. Optionally enter a manual answer key or upload an answer key file.
9. Click `Upload and Analyze`.

After upload, the system creates an item analysis record and opens the item analysis report page.

### Required Result File Format

The result file must contain these columns:

```text
Student Name | Student ID | Section | Item 1 | Item 2 | ... | Total Score
```

Accepted item values:

| Value | Meaning |
| --- | --- |
| `1` or `C` | Correct |
| `0` or `W` | Wrong |
| blank | Treated as wrong |

The `Total Score` column may be blank. If it is blank, the system computes the score from the item values.

### Downloading the Item Analysis Template

1. Enter the number of items on the `Item Analysis` upload page.
2. Click `Download Template`.
3. Fill in the downloaded Excel template.
4. Upload it as the result file.

### Using a Generated Exam Answer Key

The item analysis upload page includes a `Generated Exam Answer Key` section.

Teachers can:

1. Select one of their generated exams.
2. Click `Download Answer Key` to download the answer-key DOCX.
3. Click `Use Exam Details` to copy the selected exam title, subject, and item count into the item analysis form.

### Item Analysis Report

The item analysis report shows:

- Total students
- Number of items
- Average score
- Highest score
- Lowest score
- Item difficulty index
- Difficulty interpretation
- Discrimination index
- Discrimination interpretation
- Recommendation per item

### Exporting Item Analysis

Open an item analysis report and click the export/download action to download the Excel item analysis report.

The export includes:

- Summary
- Item analysis table
- Student scores

## 13. Common Parsing Problems and Fixes

| Problem | Cause | Fix |
| --- | --- | --- |
| Choices not detected | Choices are not written as `a.`, `b.`, `c.`, `d.` or `A.`, `B.`, `C.`, `D.` | Put each choice on its own line and use the correct labels |
| Image not attached | Image is floating, far from the question, or image count does not match question count | Set image layout to inline with text and place it directly below the related question |
| Table not detected | The table is not a real DOCX table or is inside a text box | Use Insert Table in Word and keep it in the main document body |
| Table attached to wrong question | The table is too far from the related question or placed after choices | Put the table directly below the question and before choices |
| Table rows detected as choices | Table rows start with `a.`, `b.`, `c.`, or `d.` | Do not label table rows like choices |
| Table appears but columns look wrong | Merged cells or complex formatting changed the readable structure | Use simple tables with regular rows and columns |
| Question merged with choices | The question and choices are in the same paragraph | Put the question and each choice on separate lines |
| Special characters not showing correctly | Symbols were copied from unsupported formatting or inserted as images | Type symbols directly in Word using clear Unicode characters such as `x²` |
| DOCX uploads but no questions found | The file does not follow the expected numbered question format | Use `1.`, `2.`, `3.` and choices `a.` to `d.` |
| Duplicate questions | The same DOCX was uploaded and approved more than once | Review parsed questions before approval and delete duplicates from the question bank |
| Math symbols not readable | Math is written as unclear plain text or as a screenshot | Type expressions clearly, for example `a²y = x³` |
| Correct answer missing | The source DOCX does not include `Answer: A` or the answer is blank | Select the correct answer manually during review |
| One question parsed instead of many | Questions are written as headings or labels that do not split cleanly | Use simple numbering such as `1.`, `2.`, `3.` |
| Image appears on the wrong question | Images are not ordered or placed consistently | Use one inline image per question and keep image order the same as question order |

## 14. Best Practices

1. Use the system's DOCX template.
2. Keep formatting simple.
3. Use plain text as much as possible.
4. Test upload with 3 to 5 questions first.
5. Review all parsed questions before approval.
6. Keep a backup copy of the original DOCX.
7. Avoid copying questions from screenshots.
8. Use simple Word tables when a question needs tabular data.
9. Avoid using Word text boxes, SmartArt, heavily merged table cells, or floating images.
10. Keep question numbering consistent.
11. Keep choice labels consistent.
12. Check all images after parsing.
13. Check all tables after parsing.
14. Approve only clean and verified questions.

## DOCX Parser-Friendly Template

Use this template when preparing a DOCX file for upload.

```text
Subject: Mathematics
Topic: Area Under Curves

1. Find the area bounded by the curve y = 9 - x² and the x-axis.

[Image placeholder: Insert related image here if needed. Set image layout to In Line with Text.]

a. 36 unit²
b. 35 unit²
c. 34 unit²
d. 33 unit²

Answer: A


2. Find the area bounded by the curve a²y = x³, the x-axis, and the line x = 2a.

[Image placeholder: Insert related image here if needed. Set image layout to In Line with Text.]

[Table placeholder: Insert a real DOCX table here if needed. Place the table before the choices.]

a. 4a²
b. 3a²
c. 2a²
d. a²

Answer: A


3. Find the area bounded by the curve x = y² + 2y and the line x = 3.

[Image placeholder: Insert related image here if needed. Set image layout to In Line with Text.]

[Table placeholder: Insert a real DOCX table here if needed. Place the table before the choices.]

a. 32 unit²
b. 33 unit²
c. 40 unit²
d. All of the above

Answer: A
```

## Final Checklist Before Uploading

Use this checklist before uploading a DOCX file:

- [ ] Questions are numbered `1.`, `2.`, `3.`
- [ ] Each question is on its own line.
- [ ] Choices use `a.`, `b.`, `c.`, `d.`
- [ ] Each choice is on its own line.
- [ ] No question is inside a text box.
- [ ] No question is inside SmartArt.
- [ ] Any table is a real DOCX table.
- [ ] Any table is placed directly below the related question and before choices.
- [ ] Table rows and columns are simple and readable.
- [ ] No choices are placed inside a table.
- [ ] No question depends on complicated tables or heavily merged cells.
- [ ] Images are inline with text.
- [ ] Images are placed directly below or near the related question.
- [ ] Images are clear and not too large.
- [ ] Mathematical expressions are typed clearly.
- [ ] The file was tested with a small sample first.
- [ ] A backup copy of the original DOCX was saved.
- [ ] All parsed questions will be reviewed before approval.
