import { expect, test } from "bun:test";
import { parseRssPubDate } from "../sources/rss";
import { parseP2000AlarmText } from "../sources/p2000alarm";

test("RSS pubDate: mislabeled +0100 wall clock is reinterpreted as Amsterdam", () => {
  const d = parseRssPubDate("Sun, 6 Sep 2026 23:04:55 +0100");
  expect(d.toISOString()).toBe("2026-09-06T21:04:55.000Z");
});

test("RSS pubDate: winter stamps are unaffected by the correction", () => {
  const d = parseRssPubDate("Sun, 21 Dec 2026 14:00:00 +0100");
  expect(d.toISOString()).toBe("2026-12-21T13:00:00.000Z");
});

test("RSS pubDate: garbage falls back to current time without throwing", () => {
  const d = parseRssPubDate("complete nonsense");
  expect(Math.abs(Date.now() - d.getTime())).toBeLessThan(5_000);
});

const FIXTURE =
  '<div class="row wrap"><div class="cell f65 pDate vd">06-09-2026</div><div class="cell f50 center Prio2">Prio 2</div>' +
  '<div class="cell pDate vm">06-09-2026 23:47:49</div><div class="cell pDisA">A2 Woerden 146159</div></div>' +
  '<div class="row"><div class="cell f65 right"><a href="/capcode/0726124" class="pCapA dl">0726124</a></div>' +
  '<div class="cell f50 pTime">23:47:49</div><div class="cell"><a href="/Utrecht" class="pRegio dl">Utrecht</a> ' +
  '<a href="/capcode/0726124" class="pOmsA dl">Spoed ambu 09-124</a></div></div>' +
  "<M>" +
  '<div class="row wrap"><div class="cell f65 pDate vd">06-09-2026</div><div class="cell f50 center">&nbsp;</div>' +
  '<div class="cell pDate vm">06-09-2026 23:44:49</div><div class="cell pDisP">Aanrijding letsel Graafseweg Nijmegen 683309</div></div>' +
  '<div class="row"><div class="cell f65 right"><a href="/capcode/0830999" class="pCapP dl">0830999</a></div>' +
  '<div class="cell f50 pTime">23:44:49</div><div class="cell"><a href="/capcode/0830999" class="pOmsP dl">Meldkamer Politie Oost-Nederland (Apeldoorn)</a></div></div>' +
  "<D>server message<D>123<D>999999";

test("p2000alarm fixture: ambulance record", () => {
  const items = parseP2000AlarmText(FIXTURE);
  expect(items.length).toBe(2);
  expect(items[0].message).toBe("A2 Woerden 146159");
  expect(items[0].dienst).toBe("Ambulance");
  expect(items[0].regName).toBe("Utrecht");
  expect(items[0].capcode).toBe("0726124");
  expect(items[0].detail).toBe("Spoed ambu 09-124");
  expect(items[0].pubDate.toISOString()).toBe("2026-09-06T21:47:49.000Z");
});

test("p2000alarm fixture: politie record without priority cell", () => {
  const items = parseP2000AlarmText(FIXTURE);
  expect(items[1].dienst).toBe("Politie");
  expect(items[1].detail).toBe("Meldkamer Politie Oost-Nederland (Apeldoorn)");
});

test("p2000alarm: Error responses throw", () => {
  expect(() => parseP2000AlarmText("Error 36")).toThrow(/unexpected response/);
});

test("p2000alarm: entity decoding is order-safe and handles numeric refs", () => {
  const fixture =
    '<div class="cell pDisA">A &amp;lt; B &#233; &nbsp;Caf&#233;</div><M><D>x<D>1<D>2';
  const [item] = parseP2000AlarmText(fixture);
  expect(item.message).toBe("A &lt; B é Café");
});
