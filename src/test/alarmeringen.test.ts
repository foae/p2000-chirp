import { expect, test } from "bun:test";
import { inferDiscipline, matchesArea } from "../filter";
import { parseAlarmeringenRss } from "../sources/alarmeringen";

function rss(items: string): string {
  return `<rss version="2.0"><channel>${items}</channel></rss>`;
}

function item(overrides: Partial<Record<"title" | "link" | "description" | "pubDate", string>> = {}): string {
  const fields = {
    title: "p 1 testmelding 1234AB",
    link: "https://alarmeringen.nl/incident/123?utm_source=rss",
    description: "Brandweer naar Teststraat",
    pubDate: "Sun, 6 Sep 2026 23:04:55 +0000",
    ...overrides,
  };
  return `<item><title>${fields.title}</title><link>${fields.link}</link><description>${fields.description}</description><pubDate>${fields.pubDate}</pubDate></item>`;
}

test("Alarmeringen RSS respects the published UTC offset through Amsterdam DST", () => {
  const items = parseAlarmeringenRss(rss(
    item({ pubDate: "Sun, 6 Sep 2026 23:04:55 +0000" }) +
    item({ pubDate: "Sun, 6 Sep 2026 23:04:55 +0200" }),
  ));

  expect(items.map(({ pubDate }) => pubDate.toISOString())).toEqual([
    "2026-09-06T23:04:55.000Z",
    "2026-09-06T21:04:55.000Z",
  ]);
});

test("Alarmeringen RSS takes a prefixless lowercased police title's discipline from its headline", () => {
  const [parsed] = parseAlarmeringenRss(rss(item({
    title: "verdachte situatie bij station",
    description: "politie naar Stationsplein",
  })));

  expect(parsed.message).toBe("verdachte situatie bij station");
  expect(parsed.dienst).toBe("Politie");
  expect(inferDiscipline(parsed)).toBe("Politie");
});

test("Alarmeringen RSS preserves the raw dispatch title for postcode filtering", () => {
  const [parsed] = parseAlarmeringenRss(rss(item({
    title: "p 1 melding 1234AB &amp; vervolg",
    description: "Brandweer naar een herschreven kop die geen melding is",
  })));

  expect(parsed.message).toBe("p 1 melding 1234AB & vervolg");
  expect(matchesArea(parsed, {
    regions: [], postcodes: ["1234"], keywords: [], disciplines: [], radius: null,
  })).toBe(true);
  expect(parsed.detail).toBe(
    "Bron: Alarmeringen.nl (CC BY-NC-ND 3.0)\nhttps://alarmeringen.nl/incident/123?utm_source=rss",
  );
});

test("Alarmeringen RSS accepts an empty channel but rejects malformed feeds and incomplete records", () => {
  expect(parseAlarmeringenRss(rss(""))).toEqual([]);
  expect(() => parseAlarmeringenRss(rss("<item/>"))).toThrow(/RSS item/);
  expect(() => parseAlarmeringenRss("<html><body>error</body></html>")).toThrow(/RSS channel/);
  expect(() => parseAlarmeringenRss("<rss><channel><item></channel></rss>")).toThrow(/RSS XML/);
  expect(() => parseAlarmeringenRss(rss(item({ title: "" })))).toThrow(/title/);
  expect(() => parseAlarmeringenRss(rss(item({ link: "" })))).toThrow(/link/);
  expect(() => parseAlarmeringenRss(rss(item({ pubDate: "" })))).toThrow(/pubDate/);
  expect(() => parseAlarmeringenRss(rss(item({ link: "https://example.com/incident/123" })))).toThrow(/item link/);
});
