---
"@expressive/dom": minor
---

`<title>`, `<meta>` and `<link>` render into `document.head` from anywhere, outside SVG, shadow roots and microdata - the latest title wins and unmounting restores the one before. `renderToString` returns them as `head`.

JSX types now include microdata props (`itemProp`, `itemScope`, `itemType`, `itemID`, `itemRef`) and `charSet` and `property` on `<meta>`.
