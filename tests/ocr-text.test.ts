import { describe, expect, test } from "bun:test";
import { appendOcrTextToTextContent } from "@src/services/ocr-text";

describe("OCR text display merge", () => {
  test("shows OCR text when the visible text field is empty", () => {
    expect(appendOcrTextToTextContent("", "Sign in\nContinue")).toBe("Sign in\nContinue");
  });

  test("appends OCR text to existing visible text", () => {
    expect(appendOcrTextToTextContent("Saved from x.com", "Menu\nPost")).toBe(
      "Saved from x.com\n\nMenu\nPost"
    );
  });

  test("does not duplicate OCR text already merged into visible text", () => {
    expect(appendOcrTextToTextContent("Saved from x.com\n\nMenu\nPost", "Menu\nPost")).toBe(
      "Saved from x.com\n\nMenu\nPost"
    );
  });
});
