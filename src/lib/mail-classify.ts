/**
 * What a job email means for the application, in the order a hiring process actually moves:
 * received → in review → assessment → interview → offer, or rejection at any point.
 *
 * The order of the checks matters: a rejection often mentions "interview", and a receipt often says
 * "we'll be in touch about next steps" — neither of those is an interview invitation.
 * `sure: false` means the wording is suggestive but not decisive; callers confirm those with AI before
 * moving an application forward.
 */
export type MailKind = "verification" | "received" | "action" | "in_review" | "assessment" | "interview" | "offer" | "rejection" | "other";

const VERIFY = /security code|verification code|verify your (email|account|identity)|confirm your (email|account)|activate your account|one[- ]time (pass)?code|passcode|sign[- ]in code|login code|\botp\b|validate your email/;
const OFFER = /pleased to (extend|offer)|offer letter|extend(ing)? (you )?an offer|offer of employment|(formal|verbal) offer|congratulations[^.]{0,80}\boffer\b/;
const REJECT = /unfortunately|not (to )?(be )?moving forward|move forward with other|other candidates|not been selected|not selected|decided (not )?to (pursue|proceed) (with )?(other|another)|decided not to (proceed|move)|regret to inform|position has been filled|role has been filled|will not be proceeding|won['’]t be proceeding|no longer (being )?considered|not (be )?progressing|not a (fit|match) at this time|closed this (role|position|requisition)/;
// Concrete invitations only. "Next steps" on its own is not one.
const INTERVIEW = /invite you (to|for) (an? |a short |a quick )?(interview|phone|video|call|chat|conversation|meet|onsite|on-site)|(like|love|want) to (schedule|set up|arrange|invite you|speak with you|chat with you|talk with you|meet with you)|schedule (an? |your |the )?(interview|call|phone screen|chat|conversation|time to (talk|chat|meet|speak))|interview (invitation|invite|request|availability|confirmation|confirmed|scheduled|details|loop)|your (upcoming|scheduled) (interview|call)|phone screen|recruiter (call|screen)|hiring manager (call|interview|screen)|calendly\.com|goodtime\.io|greenhouse\.io\/scheduling|select a time|pick a time|book a time|choose a time|share your availability|provide your availability|availability for (an? )?(interview|call|chat|conversation)|next round|(move|moving|advance|advancing) (you )?(forward )?to the next (stage|round|step)|meet the (team|hiring manager)|onsite interview|panel interview|final (round|interview)/;
const ASSESS = /assessment|coding (challenge|exercise|test)|hackerrank|codility|codesignal|coderbyte|testgorilla|qualified\.io|take[- ]home|online test|hirevue|skills test|case study|work sample|exercise to complete|technical (test|challenge)|complete (the|this|a|our) (questionnaire|challenge|test)/;
const RECEIVED = /thank(s| you)( so much)? for (applying|your application|your interest|submitting|applying to)|application (has been |was |is )?(received|submitted|complete|confirmed)|we('ve| have) received your application|successfully (submitted|applied)|received your (application|resume)|confirm(ing)? (receipt|we('ve)? received)|application confirmation|your application (was|has been) sent to|application sent to|indeed application:|items were sent to/;
// The site says the application isn't finished ("if you did not proceed to the final step, complete this form").
const ACTION = /further action (may be |is )?required|action (is )?required (on|for) your application|complete your application|finish your application|(did not|didn['’]t) (proceed|complete|finish)[^.]{0,60}(application|final step)|application (is )?(incomplete|not (yet )?complete)/;
const REVIEW = /under review|being reviewed|currently reviewing|in review|review(ing)? your (application|profile|candidacy)/;
// A person saying the application is going ahead ("you've been shortlisted", "we'd like to move forward with you").
const SHORTLIST = /short-?listed|(like|love|happy|pleased|excited|glad|decided) to (move|moving|go|proceed) (forward|ahead) with (you|your)|selected (you )?to (move|go) forward|(move|moving|progress|progressing|advance|advancing) your (application|candidacy) (forward|to)|your (application|profile) (has been|was) (selected|progressed|advanced)|(passed|cleared) (the )?(initial|first) (review|screen)/;
// "Next steps" from a person is suggestive, not decisive (receipts say "we'll be in touch about next steps").
const NEXT_STEPS = /next steps? (in|for) (the|your) (process|application|candidacy)|discuss (the )?next steps|regarding next steps|next steps with you/;

/**
 * Sentences that only describe what happens *if* you're turned down ("If you are not selected, keep an eye on our
 * jobs page") are boilerplate in receipts, not rejections. Drop them before looking for a rejection.
 */
function withoutConditionals(s: string) {
  return s
    .split(/(?<=[.!?])\s+/)
    .filter((x) => !/\b(if|should|in the event|in case|whether or not|unless)\b[^.]{0,80}\b(not|unfortunately|other candidates|move forward|moving forward|selected|unsuccessful)/.test(x))
    .join(" ");
}

export function classifyMail(fromAddr: string, subject: string, text: string): { kind: MailKind; sure: boolean } {
  const from = fromAddr.trim().toLowerCase();
  if (/@accounts\.google\.com$|@google\.com$/.test(from)) return { kind: "other", sure: true };
  const subj = subject.toLowerCase();
  const s = `${subj}\n${text.slice(0, 6000)}`.toLowerCase().replace(/\s+/g, " ");
  if (VERIFY.test(s) && !INTERVIEW.test(subj)) return { kind: "verification", sure: true };
  if (OFFER.test(s) && !REJECT.test(s)) return { kind: "offer", sure: false };
  const firm = withoutConditionals(s);
  if (REJECT.test(firm)) return { kind: "rejection", sure: !INTERVIEW.test(subj) && !RECEIVED.test(subj) };
  if (ACTION.test(s)) return { kind: "action", sure: true };
  if (INTERVIEW.test(s)) {
    // A receipt that merely mentions "we may schedule a call" is still a receipt.
    const receiptOnly = RECEIVED.test(subj) && !INTERVIEW.test(subj) && /(if|should) (your|you|we)[^.]{0,80}(fit|match|move forward|interested)/.test(s);
    return receiptOnly ? { kind: "received", sure: false } : { kind: "interview", sure: INTERVIEW.test(subj) };
  }
  if (ASSESS.test(s)) return { kind: "assessment", sure: ASSESS.test(subj) };
  // "If we'd like to move forward, we'll contact you" is a receipt; "we'd like to move forward with you" is not.
  if (SHORTLIST.test(firm)) return { kind: "in_review", sure: !RECEIVED.test(subj) };
  if (RECEIVED.test(s)) return { kind: "received", sure: true };
  if (REVIEW.test(s) || NEXT_STEPS.test(firm)) return { kind: "in_review", sure: false };
  return { kind: "other", sure: true };
}

/**
 * Application status a mail moves to, if any. An automatic receipt is not a reply from a person: the application
 * stays "Applied" (the receipt is recorded as an event), so "heard back" only counts real responses.
 */
export const STATUS_FOR: Partial<Record<MailKind, string>> = {
  in_review: "in_review",
  assessment: "assessment",
  interview: "interview",
  offer: "offer",
  rejection: "rejected",
};

/** Pipeline order. Applications never move backwards, and a closed one only re-opens on an interview or offer. */
export const PIPELINE = ["saved", "ready", "applied", "in_review", "assessment", "interview", "offer"];

export function nextStatus(current: string, kind: MailKind): string | undefined {
  const want = STATUS_FOR[kind];
  if (!want) return undefined;
  if (want === "rejected") return ["offer"].includes(current) || current === "rejected" ? undefined : "rejected";
  if (current === "rejected" || current === "withdrawn") return ["interview", "offer"].includes(want) ? want : undefined;
  return PIPELINE.indexOf(want) > PIPELINE.indexOf(current) ? want : undefined;
}
