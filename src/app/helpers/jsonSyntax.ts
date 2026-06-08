import { DomSanitizer, SafeHtml } from "@angular/platform-browser";


export function prettyJson(data: object, sanitizer: DomSanitizer): SafeHtml {
  const jsonString = JSON.stringify(data, null, 2);
  const html = syntaxHighlight(jsonString);
  return sanitizer.bypassSecurityTrustHtml(html);
}

export function syntaxHighlight(json: string): string {
  if (!json) return '';
  json = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    match => {
      let cls = 'number';
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'key' : 'string';
      } else if (/true|false/.test(match)) {
        cls = 'boolean';
      } else if (/null/.test(match)) {
        cls = 'null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}