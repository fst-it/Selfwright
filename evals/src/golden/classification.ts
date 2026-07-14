// Synthetic sentences only — no real JD text, no personal data (data-leak gate).
export type ClassificationLabel = "requirement" | "perk" | "company_info" | "other";

export type ClassificationFixture = {
  readonly id: string;
  readonly sentence: string;
  readonly expectedLabel: ClassificationLabel;
};

export const CLASSIFICATION_FIXTURES: readonly ClassificationFixture[] = [
  { id: "c1", sentence: "Must have 3+ years of experience with Python.", expectedLabel: "requirement" },
  {
    id: "c2",
    sentence: "Bachelor's degree in Computer Science or related field required.",
    expectedLabel: "requirement",
  },
  {
    id: "c3",
    sentence: "Strong communication skills are essential for this role.",
    expectedLabel: "requirement",
  },
  {
    id: "c4",
    sentence: "Experience with cloud platforms such as AWS or GCP is required.",
    expectedLabel: "requirement",
  },
  {
    id: "c5",
    sentence: "Candidates must be authorized to work in the country of employment.",
    expectedLabel: "requirement",
  },
  {
    id: "c6",
    sentence: "We offer unlimited PTO and a flexible remote-work policy.",
    expectedLabel: "perk",
  },
  {
    id: "c7",
    sentence: "Enjoy a generous 401(k) match and full health coverage.",
    expectedLabel: "perk",
  },
  {
    id: "c8",
    sentence: "Employees receive an annual learning stipend of $2,000.",
    expectedLabel: "perk",
  },
  {
    id: "c9",
    sentence: "Our office includes a fully stocked kitchen and gym access.",
    expectedLabel: "perk",
  },
  {
    id: "c10",
    sentence: "We provide a one-time home-office setup bonus for new hires.",
    expectedLabel: "perk",
  },
  {
    id: "c11",
    sentence: "Founded in 2010, our company has grown to over 500 employees worldwide.",
    expectedLabel: "company_info",
  },
  {
    id: "c12",
    sentence: "We are a fast-growing fintech startup headquartered in Amsterdam.",
    expectedLabel: "company_info",
  },
  {
    id: "c13",
    sentence: "Our mission is to make renewable energy accessible to everyone.",
    expectedLabel: "company_info",
  },
  {
    id: "c14",
    sentence: "The company recently closed a $50M Series C funding round.",
    expectedLabel: "company_info",
  },
  {
    id: "c15",
    sentence: "We serve customers across 30 countries from our three global offices.",
    expectedLabel: "company_info",
  },
  { id: "c16", sentence: "Please apply by clicking the button below.", expectedLabel: "other" },
  { id: "c17", sentence: "This position is based in our downtown office.", expectedLabel: "other" },
  { id: "c18", sentence: "We are an equal opportunity employer.", expectedLabel: "other" },
  { id: "c19", sentence: "Interviews will be conducted over two rounds.", expectedLabel: "other" },
  { id: "c20", sentence: "Thank you for considering a career with us.", expectedLabel: "other" },
];
