'use strict';
/**
 * Generates two files:
 *   bluewater-letterhead.docx   — A4 letterhead template for GBP verification & correspondence
 *   bluewater-business-card.docx — 8-up print-ready business cards (2×4 on A4)
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, TabStopType, TabStopPosition
} = require('docx');
const fs = require('fs');

const NAVY  = '0F1B2D';
const RUST  = 'C75634';
const GREY  = '5A6273';
const LGREY = 'D0D4DB';
const WHITE = 'FFFFFF';

// ─── LETTERHEAD ──────────────────────────────────────────────────────────────
// A4: 11906 × 16838 DXA | margins: top 720, sides/bottom 1134
// Content width: 11906 - 2268 = 9638 DXA

function makeLetterhead() {
  return new Document({
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 22, color: NAVY } }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 720, right: 1134, bottom: 1134, left: 1134 }
        }
      },
      headers: {
        default: new Header({
          children: [
            // Row 1: company name (left) + phone (right)
            new Paragraph({
              children: [
                new TextRun({ text: 'BLUEWATER ASSOCIATES LIMITED', bold: true, size: 36, color: NAVY, font: 'Arial' }),
                new TextRun({ text: '\t0800 088 4711', size: 20, color: GREY, font: 'Arial' }),
              ],
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              spacing: { before: 0, after: 60 }
            }),
            // Row 2: tagline (left) + email | web (right) + ruled bottom border
            new Paragraph({
              children: [
                new TextRun({ text: 'Cyber Security & IT Consultancy', italics: true, size: 20, color: RUST, font: 'Arial' }),
                new TextRun({ text: '\thello@bluewaterassociates.co.uk   |   bluewaterassociates.co.uk', size: 18, color: GREY, font: 'Arial' }),
              ],
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: NAVY, space: 8 } },
              spacing: { after: 0 }
            }),
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: '80 Birkenhead Road, Meols, Wirral, CH47 0LB', size: 16, color: GREY, font: 'Arial' }),
                new TextRun({ text: '\tCompany No. 16663061   |   ICO Reg. ZC156613   |   Registered in England & Wales', size: 16, color: GREY, font: 'Arial' }),
              ],
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              border: { top: { style: BorderStyle.SINGLE, size: 4, color: LGREY, space: 8 } },
              spacing: { before: 0 }
            })
          ]
        })
      },
      children: [
        // Date
        new Paragraph({
          children: [new TextRun({ text: '[Date]', color: GREY })],
          spacing: { before: 360, after: 720 }
        }),
        // Addressee block
        new Paragraph({ children: [new TextRun('[Recipient Name]')], spacing: { after: 0 } }),
        new Paragraph({ children: [new TextRun('[Company]')],        spacing: { after: 0 } }),
        new Paragraph({ children: [new TextRun('[Address Line 1]')], spacing: { after: 0 } }),
        new Paragraph({ children: [new TextRun('[Address Line 2]')], spacing: { after: 0 } }),
        new Paragraph({ children: [new TextRun('[Town / City, Postcode]')], spacing: { after: 720 } }),
        // Subject
        new Paragraph({
          children: [new TextRun({ text: 'Re: [Subject]', bold: true })],
          spacing: { after: 480 }
        }),
        // Salutation
        new Paragraph({ children: [new TextRun('Dear [Name],')], spacing: { after: 480 } }),
        // Body lines
        new Paragraph({ children: [new TextRun('')] }),
        new Paragraph({ children: [new TextRun('')] }),
        new Paragraph({ children: [new TextRun('')] }),
        new Paragraph({ children: [new TextRun('')] }),
        // Sign-off
        new Paragraph({ children: [new TextRun('Yours sincerely,')], spacing: { before: 960, after: 1440 } }),
        new Paragraph({ children: [new TextRun({ text: 'Paul McWilliam', bold: true })], spacing: { after: 0 } }),
        new Paragraph({ children: [new TextRun({ text: 'Director', color: GREY })],                                    spacing: { after: 0 } }),
        new Paragraph({ children: [new TextRun({ text: 'Bluewater Associates Limited', color: GREY })], spacing: { after: 0 } }),
        new Paragraph({ children: [new TextRun({ text: 'T: 0800 088 4711', color: GREY, size: 20 })],   spacing: { after: 0 } }),
        new Paragraph({ children: [new TextRun({ text: 'E: hello@bluewaterassociates.co.uk', color: GREY, size: 20 })], spacing: { after: 0 } }),
      ]
    }]
  });
}

// ─── BUSINESS CARD ───────────────────────────────────────────────────────────
// Card: 85mm × 55mm = 4819 × 3118 DXA
// Layout: 2 columns × 4 rows = 8 cards per A4 sheet
// A4 portrait with 20mm side margins: 11906 - 2267 = 9639 content width
// 2 × 4819 = 9638 — fits perfectly with 1134 DXA margins each side
// Row height: 3118 DXA each, 4 rows = 12472 total (fits in A4 body area)

const CARD_W = 4819; // DXA — 85mm
const CARD_H = 3118; // DXA — 55mm

const noBorder  = { style: BorderStyle.NONE,   size: 0, color: 'FFFFFF' };
const cutBorder = { style: BorderStyle.DASHED,  size: 4, color: LGREY   };
const allCut    = { top: cutBorder, bottom: cutBorder, left: cutBorder, right: cutBorder };

function makeCard(name, title) {
  // Card layout uses a 2-column inner table: navy sidebar (12mm) + content
  const sideW    = 680;  // ~12mm navy sidebar
  const contentW = CARD_W - sideW - 1; // remaining

  return new TableCell({
    width: { size: CARD_W, type: WidthType.DXA },
    borders: allCut,
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: [
      new Table({
        width: { size: CARD_W, type: WidthType.DXA },
        columnWidths: [sideW, contentW],
        borders: {
          top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
          insideH: noBorder, insideV: noBorder,
        },
        rows: [new TableRow({
          height: { value: CARD_H, rule: 'exact' },
          children: [
            // Navy sidebar
            new TableCell({
              width: { size: sideW, type: WidthType.DXA },
              shading: { fill: NAVY, type: ShadingType.CLEAR },
              verticalAlign: VerticalAlign.CENTER,
              borders: {
                top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
              },
              margins: { top: 0, bottom: 0, left: 80, right: 80 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 0, after: 0 },
                  children: [
                    new TextRun({ text: 'B', bold: true, size: 36, color: WHITE, font: 'Arial' }),
                  ]
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 0, after: 0 },
                  children: [
                    new TextRun({ text: 'A', bold: true, size: 36, color: RUST, font: 'Arial' }),
                  ]
                }),
              ]
            }),
            // Content area
            new TableCell({
              width: { size: contentW, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              borders: {
                top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
              },
              margins: { top: 120, bottom: 120, left: 160, right: 120 },
              children: [
                new Paragraph({
                  spacing: { before: 0, after: 60 },
                  children: [new TextRun({ text: 'BLUEWATER ASSOCIATES', bold: true, size: 18, color: NAVY, font: 'Arial' })]
                }),
                new Paragraph({
                  spacing: { before: 0, after: 160 },
                  children: [new TextRun({ text: 'LIMITED', bold: true, size: 14, color: NAVY, font: 'Arial' })]
                }),
                new Paragraph({
                  spacing: { before: 0, after: 40 },
                  children: [new TextRun({ text: name, bold: true, size: 22, color: NAVY, font: 'Arial' })]
                }),
                new Paragraph({
                  spacing: { before: 0, after: 160 },
                  children: [new TextRun({ text: title, italics: true, size: 18, color: RUST, font: 'Arial' })]
                }),
                new Paragraph({
                  spacing: { before: 0, after: 30 },
                  children: [new TextRun({ text: '0800 088 4711', size: 16, color: GREY, font: 'Arial' })]
                }),
                new Paragraph({
                  spacing: { before: 0, after: 30 },
                  children: [new TextRun({ text: 'hello@bluewaterassociates.co.uk', size: 14, color: GREY, font: 'Arial' })]
                }),
                new Paragraph({
                  spacing: { before: 0, after: 0 },
                  children: [new TextRun({ text: 'bluewaterassociates.co.uk', size: 14, color: GREY, font: 'Arial' })]
                }),
              ]
            }),
          ]
        })]
      })
    ]
  });
}

function makeBusinessCards() {
  // 8 identical cards, 2-up per row, 4 rows
  const rows = [];
  for (let i = 0; i < 4; i++) {
    rows.push(new TableRow({
      height: { value: CARD_H, rule: 'exact' },
      children: [
        makeCard('Paul McWilliam', 'Director'),
        makeCard('Paul McWilliam', 'Director'),
      ]
    }));
  }

  return new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4 portrait
          margin: { top: 567, right: 1134, bottom: 567, left: 1134 }
        }
      },
      children: [
        new Paragraph({
          children: [new TextRun({ text: 'Bluewater Associates — Business Cards (print & cut)', size: 16, color: LGREY, font: 'Arial' })],
          spacing: { after: 120 }
        }),
        new Table({
          width: { size: 9638, type: WidthType.DXA },
          columnWidths: [CARD_W, CARD_W],
          borders: {
            top: noBorder, bottom: noBorder, left: noBorder, right: noBorder,
            insideH: noBorder, insideV: noBorder,
          },
          rows
        }),
      ]
    }]
  });
}

// ─── GENERATE ────────────────────────────────────────────────────────────────
Promise.all([
  Packer.toBuffer(makeLetterhead()),
  Packer.toBuffer(makeBusinessCards()),
]).then(([lhBuf, bcBuf]) => {
  fs.writeFileSync('bluewater-letterhead.docx', lhBuf);
  fs.writeFileSync('bluewater-business-card.docx', bcBuf);
  console.log('Done: bluewater-letterhead.docx');
  console.log('Done: bluewater-business-card.docx');
}).catch(err => {
  console.error(err);
  process.exit(1);
});
