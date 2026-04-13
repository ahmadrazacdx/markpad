# MarkPad Render Smoke Test

Use this document to validate the full markdown-to-PDF pipeline before release.

## Preflight

1. Upload these files into your project assets tree:
   - `assets/chart.png`
   - `assets/diagram.svg`
2. Set the file name to `main.md` (or render this file directly).
3. Confirm preview is connected and updates live.

## Basic Syntax

# Heading 1
## Heading 2
### Heading 3

This paragraph checks **bold**, *italic*, ***bold+italic***, ~~strikethrough~~, `inline code`, and [inline links](https://example.com).

A plain URL should also work: <https://example.com/docs>.

> Blockquote level 1
>> Blockquote level 2
>
> - quoted list item
> - second item

---

## Lists

- Bullet A
- Bullet B
  - Nested bullet B.1
  - Nested bullet B.2
- Bullet C

1. Ordered A
2. Ordered B
3. Ordered C

- [x] Task item done
- [ ] Task item open

## Table

| Feature | Expected | Notes |
|---|---|---|
| Headings | Correct hierarchy | H1-H3 visible |
| Lists | Proper indent and numbering | Nested bullets preserved |
| Table | Borders/spacing readable | No broken layout |
| Code | Monospace | Wrapping is safe |

## Code Blocks

```ts
type User = {
  id: number;
  name: string;
};

const users: User[] = [
  { id: 1, name: "Amina" },
  { id: 2, name: "Rayan" },
];

console.log(users.map((u) => `${u.id}:${u.name}`).join(", "));
```

```bash
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/markpad build
```

## Footnotes

This sentence has a footnote reference.[^smoke-note]

[^smoke-note]: Footnote content should render at the end of the document.

## HTML Blocks

<div style="border:1px solid #888; padding:8px; border-radius:6px; margin:8px 0;">
  <strong>Inline HTML block:</strong> if raw HTML is enabled, this boxed note should appear.
</div>

<details>
  <summary>HTML details element</summary>
  <p>Expandable/collapsible content in source markdown.</p>
</details>

## Math

Inline math: $E = mc^2$ and $\alpha + \beta = \gamma$.

Block math:

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

LaTeX environment block:

$$
\begin{aligned}
a^2 + b^2 &= c^2 \\
\nabla \cdot \vec{E} &= \frac{\rho}{\varepsilon_0}
\end{aligned}
$$

## Page-Break (Raw LaTeX)

This line is before a hard page break.

\newpage

This line should be on a new page when LaTeX engine is used.

## Images

Markdown image:

![Chart via markdown image syntax](assets/chart.png "Chart PNG")

Markdown image with angle brackets:

![Diagram SVG](<assets/diagram.svg>)

HTML image:

<img src="assets/chart.png" alt="Chart via HTML" width="240" />

Raw Typst image block:

```{=typst}
#figure(
  image("assets/chart.png"),
  caption: [Typst image call should resolve from assets/]
)
```

## Long Token Wrapping

supercalifragilisticexpialidocious_supercalifragilisticexpialidocious_supercalifragilisticexpialidocious

## Final Check

If this file renders with:
- no missing-image errors,
- no math parser failures,
- clean pagination,
- and no broken tables/code blocks,

then markdown rendering is ready for release smoke criteria.
