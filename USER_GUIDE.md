# Question Bank System User Guide

## Introduction

The Question Bank System is a web-based application for creating, uploading, reviewing, approving, managing, and generating exams from a centralized question bank.

The system supports:

- User registration and login
- Dashboard monitoring
- Manual question entry
- DOCX/PDF/image questionnaire upload
- Automatic parsing of multiple-choice questions
- DOCX table parsing for tables placed between the question text and choices
- Review and approval of parsed questions
- Question management
- Randomized exam generation
- DOCX download for exam papers and answer keys

## 1. Account Registration

### How to Register

1. Open the registration page.
2. Enter your full name.
3. Enter a valid email address.
4. Enter a password.
5. Click `Register`.

### Required Fields

- Full Name
- Email
- Password

### Role Selection

The current registration page does not show a role selector. New accounts are automatically created as regular `user` accounts.

The system also supports an `admin` role. Admin accounts can access protected admin features such as uploads, parsed-question review, approval, and dashboard management. Admin role assignment must be handled by an existing administrator or directly in the database/system setup.

### After Successful Registration

After successful registration:

1. The account is created.
2. The system stores your login session.
3. You are allowed to enter the system based on your assigned role.

### Common Registration Errors

| Error | Cause | Fix |
| --- | --- | --- |
| Name, email, and password are required | One or more required fields were left blank | Complete all required fields |
| Email already registered | The email is already used by another account | Use a different email or log in with the existing account |
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

## 3. Dashboard Overview

The dashboard gives administrators a quick summary of system activity.

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
- `Logout`: End the current session.

### User Roles

The system currently supports two roles:

| Role | Description |
| --- | --- |
| user | Regular account. Can log in and access allowed user features. |
| admin | Administrator account. Can upload questionnaires, review parsed questions, approve/reject questions, manage questions, and generate exams. |

There is no separate `professor` or `super admin` role in the current system.

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

Incorrect parsed questions can be removed from the workflow by clicking `Reject`.

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

### Reject Questions

Click `Reject` if the question is incorrect, incomplete, duplicated, or should not be added.

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

## 12. Common Parsing Problems and Fixes

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

## 13. Best Practices

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
