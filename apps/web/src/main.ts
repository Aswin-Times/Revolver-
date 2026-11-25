import "./style.css";

const sample = [
  {
    title: "Add checkout validation",
    repository: "class/shop-api",
    findings: 5,
    urgent: 2,
    date: "Nov 24, 2026",
  },
  {
    title: "Refactor course routes",
    repository: "class/course-portal",
    findings: 3,
    urgent: 1,
    date: "Nov 23, 2026",
  },
  {
    title: "Cover cart edge cases",
    repository: "class/shop-api",
    findings: 2,
    urgent: 0,
    date: "Nov 21, 2026",
  },
];

const metrics = [
  ["Reviews", sample.length],
  ["Total findings", sample.reduce((total, review) => total + review.findings, 0)],
  ["High or critical", sample.reduce((total, review) => total + review.urgent, 0)],
  ["Repositories", new Set(sample.map((review) => review.repository)).size],
] as const;

const metricCards = metrics.map(([label, value]) => {
  const card = document.createElement("div");
  card.className = "metric";
  const heading = document.createElement("span");
  heading.textContent = label;
  const number = document.createElement("strong");
  number.textContent = String(value);
  card.append(heading, number);
  return card;
});
document.querySelector("#metrics")?.replaceChildren(...metricCards);

const rows = sample.map((review) => {
  const row = document.createElement("tr");
  for (const value of [review.title, review.repository, review.findings, review.date]) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    row.append(cell);
  }
  return row;
});
document.querySelector("#review-rows")?.replaceChildren(...rows);
