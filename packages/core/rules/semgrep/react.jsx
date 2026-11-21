// Test cases for react.yml. Run with: semgrep --test packages/core/rules/semgrep
export function Comment({ html }) {
  // ruleid: react-dangerous-html
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Banner() {
  // ok: react-dangerous-html
  return <div dangerouslySetInnerHTML={{ __html: "<b>Welcome!</b>" }} />;
}

export function Safe({ name }) {
  // ok: react-dangerous-html
  return <div>{name}</div>;
}
