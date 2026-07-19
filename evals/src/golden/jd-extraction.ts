// Synthetic job-description snippets only — no real JD text, no personal data (data-leak gate).
export type JdExtractionFixture = {
  readonly id: string;
  readonly jdText: string;
  readonly expectedSkills: readonly string[];
};

export const JD_EXTRACTION_FIXTURES: readonly JdExtractionFixture[] = [
  {
    id: "jd-1-backend",
    jdText:
      "We are looking for a Senior Backend Engineer with strong experience in Python, " +
      "PostgreSQL, Docker, REST API design, and unit testing. You will lead a small team " +
      "and mentor junior engineers.",
    expectedSkills: ["Python", "PostgreSQL", "Docker", "REST API design", "unit testing"],
  },
  {
    id: "jd-2-frontend",
    jdText:
      "The ideal candidate has 5+ years of experience in React, TypeScript, GraphQL, " +
      "CI/CD pipelines, and accessibility standards (WCAG).",
    expectedSkills: ["React", "TypeScript", "GraphQL", "CI/CD", "accessibility (WCAG)"],
  },
  {
    id: "jd-3-data-science",
    jdText:
      "We need a Data Scientist proficient in Python, pandas, scikit-learn, SQL, and " +
      "statistical modeling to build predictive models for customer retention.",
    expectedSkills: ["Python", "pandas", "scikit-learn", "SQL", "statistical modeling"],
  },
  {
    id: "jd-4-devops",
    jdText:
      "Seeking a DevOps Engineer skilled in Kubernetes, Terraform, AWS, " +
      "monitoring/observability tools, and shell scripting.",
    expectedSkills: ["Kubernetes", "Terraform", "AWS", "monitoring/observability", "shell scripting"],
  },
  {
    id: "jd-5-backend-java",
    jdText:
      "This role requires expertise in Java, Spring Boot, microservices architecture, " +
      "Kafka, and relational database design.",
    expectedSkills: [
      "Java",
      "Spring Boot",
      "microservices architecture",
      "Kafka",
      "relational database design",
    ],
  },
];
