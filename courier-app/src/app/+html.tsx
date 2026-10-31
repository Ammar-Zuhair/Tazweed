import {
  ScrollViewStyleReset,
  useServerDocumentContext,
} from "expo-router/html";
import type { PropsWithChildren } from "react";
export default function RootHtml({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } =
    useServerDocumentContext();
  return (
    <html {...htmlAttributes} lang="ar" dir="rtl">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="color-scheme" content="light dark" />
        <ScrollViewStyleReset />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
