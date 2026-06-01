# DOCX Table Parser Test Cases

Use these cases to verify Scenario 1 table parsing after uploading a DOCX file.

## A. Text-Only Question

```text
1. What is 2 + 2?

a. 3
b. 4
c. 5
d. 6

Answer: B
```

Expected result:

- One parsed question
- No table
- No image
- Choices A to D detected

## B. Question + Image

```text
1. Refer to the figure below. What shape is shown?

[Insert inline image here]

a. Circle
b. Square
c. Triangle
d. Rectangle
```

Expected result:

- One parsed question
- Image appears below the question
- Choices remain detected

## C. Question + Table

```text
1. Given the following production data table, determine the total material cost.

[DOCX TABLE]
Material | Quantity | Unit Cost
Cement   | 20       | 280
Sand     | 5        | 1500
Gravel   | 8        | 1200

a. PHP 15,600
b. PHP 16,000
c. PHP 16,600
d. PHP 17,200
```

Expected result:

- One parsed question
- Table appears below the question text and before the choices
- Table row and column order is preserved

## D. Question + Image + Table

```text
1. Use the diagram and table below to solve the problem.

[Insert inline image here]

[DOCX TABLE]
Item | Value
A    | 10
B    | 20

a. 10
b. 20
c. 30
d. 40
```

Expected result:

- One parsed question
- Image is attached
- Table is attached
- Choices remain detected

## E. Multiple Questions with Different Tables

Create three numbered questions. Put a different DOCX table below each question before its choices.

Expected result:

- Three parsed questions
- Each question displays its own table
- Tables are not mixed between questions

## F. Table Between Choices

```text
1. Which item has the highest value?

a. Cement

[DOCX TABLE]
Material | Value
Cement   | 100
Sand     | 80

b. Sand
c. Gravel
d. Steel
```

Expected result:

- Parser does not crash
- Table is not treated as a separate question
- Choices continue parsing after the table

## G. Empty Table

Place an empty DOCX table between the question and choices.

Expected result:

- Empty table is ignored
- Question and choices still parse

## H. Merged Cells

Create a DOCX table with at least one merged cell.

Expected result:

- Parser does not crash
- Readable cell text is extracted where available
- Question remains reviewable
