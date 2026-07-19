import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { CvContent } from "@selfwright/core";

const NAVY = "1F3A5F";
const MUTED = "5A5A5A";

function sec(title: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 60 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 2 },
    },
    children: [new TextRun({ text: title.toUpperCase() })],
  });
}

function para(
  text: string,
  opts: { color?: string; size?: number; bold?: boolean; italics?: boolean; after?: number } = {},
): Paragraph {
  const runOpts: {
    text: string;
    color?: string;
    size?: number;
    bold?: boolean;
    italics?: boolean;
  } = { text };
  if (opts.color !== undefined) runOpts.color = opts.color;
  if (opts.size !== undefined) runOpts.size = opts.size;
  if (opts.bold !== undefined) runOpts.bold = opts.bold;
  if (opts.italics !== undefined) runOpts.italics = opts.italics;
  return new Paragraph({
    spacing: { after: opts.after ?? 60 },
    children: [new TextRun(runOpts)],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 40 },
    children: [new TextRun(text)],
  });
}

function roleHead(company: string, title: string, meta: string): Paragraph[] {
  return [
    new Paragraph({
      spacing: { before: 160, after: 0 },
      children: [
        new TextRun({ text: company, bold: true }),
        new TextRun({ text: ` — ${title}`, bold: true }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: meta, color: MUTED, size: 18 })],
    }),
  ];
}

export function buildDocx(cv: CvContent): Promise<Buffer> {
  const font = "Calibri";
  const children: Paragraph[] = [];

  // Header
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 20 },
      children: [new TextRun(cv.name ?? "")],
    }),
  );
  children.push(para(cv.headline ?? "", { color: MUTED, size: 20, after: 30 }));
  children.push(
    para(
      `${cv.contact?.location ?? ""} · ${cv.contact?.phone ?? ""} · ${cv.contact?.email ?? ""} · ${cv.contact?.linkedin ?? ""}`,
      { size: 19, after: 20 },
    ),
  );
  children.push(para(cv.citizenship ?? "", { size: 19, after: 40 }));

  // Summary
  children.push(sec("Summary"));
  children.push(para(cv.summary ?? ""));

  // Relevant skills
  children.push(sec("Relevant skills"));
  for (const s of cv.skills ?? []) {
    children.push(bullet(s));
  }

  // Experience
  children.push(sec("Experience"));
  for (const r of cv.roles ?? []) {
    children.push(...roleHead(r.company, r.title, `${r.period} · ${r.location}`));
    if (r.lead) children.push(para(r.lead, { after: 40 }));
    for (const b of r.bullets ?? []) {
      children.push(bullet(b));
    }
  }

  // Earlier career
  children.push(sec("Earlier career"));
  for (const e of cv.earlier_career ?? []) {
    children.push(bullet(`${e.org}${e.rest}`));
  }

  // Education
  children.push(sec("Education"));
  for (const e of cv.education ?? []) {
    children.push(bullet(e));
  }

  // Certifications
  children.push(sec("Certifications"));
  for (const c of cv.certifications ?? []) {
    children.push(bullet(c));
  }

  // Languages
  children.push(sec("Languages"));
  children.push(para(cv.languages ?? "", { after: 0 }));

  const doc = new Document({
    styles: {
      default: { document: { run: { font, size: 20 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 40, bold: true, font, color: NAVY },
          paragraph: { spacing: { after: 40 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 22, bold: true, font, color: NAVY },
          paragraph: { spacing: { before: 220, after: 60 }, outlineLevel: 1 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: "bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 220 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1080, right: 1080, bottom: 1008, left: 1080 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export function buildMd(cv: CvContent): string {
  const out: string[] = [];
  const push = (s = "") => out.push(s);

  // Header
  push(`# ${cv.name ?? ""}`);
  push(cv.headline ?? "");
  push(
    `${cv.contact?.location ?? ""} · ${cv.contact?.phone ?? ""} · ${cv.contact?.email ?? ""} · [${cv.contact?.linkedin ?? ""}](${cv.contact?.linkedin ?? ""})`,
  );
  push(cv.citizenship ?? "");
  push();

  // Summary
  push("## Summary");
  push(cv.summary ?? "");
  push();

  // Relevant skills
  push("## Relevant skills");
  for (const s of cv.skills ?? []) {
    push(`- ${s}`);
  }
  push();

  // Experience
  push("## Experience");
  push();
  for (const r of cv.roles ?? []) {
    push(`### ${r.company} — ${r.title}`);
    push(`${r.period} · ${r.location}`);
    if (r.lead) push(r.lead);
    for (const b of r.bullets ?? []) {
      push(`- ${b}`);
    }
    push();
  }

  // Earlier career
  push("## Earlier career");
  for (const e of cv.earlier_career ?? []) {
    push(`- **${e.org}**${e.rest}`);
  }
  push();

  // Education
  push("## Education");
  for (const e of cv.education ?? []) {
    push(`- ${e}`);
  }
  push();

  // Certifications
  push("## Certifications");
  for (const c of cv.certifications ?? []) {
    push(`- ${c}`);
  }
  push();

  // Languages
  push("## Languages");
  push(cv.languages ?? "");

  return out.join("\n") + "\n";
}
