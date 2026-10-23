import assert from "node:assert/strict";
import test from "node:test";
import { htmlToText, linkProblem, pageText } from "../src/import-link.ts";

test("turns a course page's HTML into readable lines", () => {
  const html = `<html><head><style>p{color:red}</style><script>track()</script></head>
    <body><h1>CS&nbsp;124 &amp; friends</h1><ul><li>MP1 due Oct 30</li><li>Quiz &#55; due Nov 2</li></ul>
    <!-- hidden --><p>Office hours: <b>Mon</b></p></body></html>`;
  assert.equal(
    htmlToText(html),
    "CS 124 & friends\nMP1 due Oct 30\nQuiz 7 due Nov 2\nOffice hours: Mon",
  );
});

test("only fetches public https links", () => {
  assert.equal(linkProblem("https://cs124.org/schedule"), null);
  assert.match(linkProblem("cs124.org")!, /isn't a link/);
  assert.match(linkProblem("http://cs124.org")!, /https/);
  for (const local of [
    "https://localhost:3000/",
    "https://127.0.0.1/",
    "https://192.168.1.5/",
    "https://printer.local/",
  ]) {
    assert.match(linkProblem(local)!, /public website/, local);
  }
});

test("explains pages that need a login or build themselves", () => {
  assert.throws(
    () => pageText('<form><input type="password" name="pw"></form>'),
    /log in.*paste the text/,
  );
  assert.throws(
    () => pageText('<div id="root"></div><script src="app.js"></script>'),
    /builds itself/,
  );
  const long = `<p>${"Homework 3 is due Friday at 5 pm. ".repeat(10)}</p>`;
  assert.match(pageText(long), /^Homework 3/);
});
