/** Only closed, trivial utterances bypass planning. Any factual or ambiguous
 * request still goes through the model's tool decision, never a keyword guess. */
export function isSmallTalk(text: string): boolean {
  return /^(?:hi|hey|hello|thanks|thank you|good morning|good evening|good night|नमस्ते)[!.\s]*$/iu.test(
    text.trim(),
  );
}
