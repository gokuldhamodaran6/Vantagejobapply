import "server-only";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";
import { refreshBoard } from "./engine";
import { resolveCompany, type Board } from "./sources";

/**
 * Employers to look for. Discovery probes each one's public careers feed (Greenhouse, Lever, Ashby,
 * Workable, Recruitee, SmartRecruiters) and starts tracking the ones it finds. Users add more by name or link.
 */
export const DISCOVERY_SEEDS = [
  // Tech & AI
  "Databricks", "Snowflake", "Asana", "Atlassian", "Twilio", "Okta", "Zoom", "HubSpot", "Gusto", "Rippling", "Deel", "Brex", "Plaid", "Chime", "Affirm", "Marqeta", "SoFi",
  "Toast", "Samsara", "Scale AI", "Mistral AI", "Perplexity", "Hugging Face", "Cohere", "Runway", "Jasper", "Glean", "Retool", "Airtable", "Miro", "Canva", "Grammarly",
  "Duolingo", "Webflow", "Squarespace", "Wix", "Zapier", "Calendly", "Loom", "Intercom", "Zendesk", "Gong", "Outreach", "Salesloft", "Amplitude", "Mixpanel", "Segment",
  "Braze", "Iterable", "Klaviyo", "Attentive", "Sprout Social", "Hootsuite", "Buffer", "Later", "Semrush", "Similarweb", "Contentful", "Sanity", "Algolia", "Elastic",
  "MongoDB", "Confluent", "HashiCorp", "PagerDuty", "New Relic", "Sentry", "LaunchDarkly", "Postman", "GitHub", "Netlify", "Fastly", "Akamai", "DigitalOcean", "Twitch",
  "Roblox", "Unity", "Epic Games", "Riot Games", "Niantic", "Snap", "Snapchat", "Pinterest", "Tumblr", "Medium", "Substack", "Patreon", "Discord", "Slack", "Dropbox", "Box",
  "DocuSign", "Carta", "Mercury", "Ramp", "Navan", "Expensify", "Bill.com", "Stripe", "Adyen", "Checkout.com", "Klarna", "Revolut", "N26", "Wise", "Monzo", "Starling Bank",
  "Coinbase", "Kraken", "Chainalysis", "Circle", "Robinhood", "Wealthfront", "Betterment", "Acorns", "NerdWallet", "Credit Karma", "Opendoor", "Zillow", "Redfin", "Compass",
  // Consumer, retail, marketplace
  "Airbnb", "Lyft", "Uber", "DoorDash", "Instacart", "Gopuff", "Grubhub", "Postmates", "Etsy", "Wayfair", "Chewy", "Warby Parker", "Allbirds", "Glossier", "Everlane",
  "Peloton", "Whoop", "Oura", "Strava", "Calm", "Headspace", "Noom", "Hims & Hers", "Ro", "Function of Beauty", "Harry's", "Dollar Shave Club", "Casper", "Away", "Rent the Runway",
  "StockX", "GOAT", "Depop", "Poshmark", "ThredUp", "Faire", "Shopify", "Gymshark", "Lululemon", "Nike", "Adidas", "Patagonia", "Sephora", "Ulta Beauty", "Estee Lauder",
  "L'Oreal", "Unilever", "Procter & Gamble", "PepsiCo", "Coca-Cola", "Mondelez", "Kraft Heinz", "Nestle", "Danone", "Red Bull", "Spotify", "SoundCloud", "Netflix", "Hulu",
  "Warner Bros. Discovery", "Paramount", "NBCUniversal", "The New York Times", "Vox Media", "BuzzFeed", "Conde Nast", "Hearst",
  // Health & bio
  "Oscar Health", "Devoted Health", "Cityblock Health", "Oak Street Health", "One Medical", "Tempus", "Flatiron Health", "Benchling", "Ginkgo Bioworks", "23andMe",
  "Color Health", "Lyra Health", "Spring Health", "Talkspace", "Cerebral", "Hinge Health", "Sword Health", "Omada Health", "Zocdoc", "GoodRx", "Doximity",
  // Mobility, energy, industrial
  "Tesla", "Rivian", "Lucid Motors", "Waymo", "Cruise", "Aurora", "Nuro", "Zoox", "Joby Aviation", "Archer Aviation", "Relativity Space", "Rocket Lab", "Planet Labs",
  "Anduril", "Shield AI", "Saildrone", "Commonwealth Fusion Systems", "Redwood Materials", "Northvolt", "Sunrun", "Enphase", "Arcadia", "Octopus Energy",
  // Consulting, services, B2B
  "McKinsey", "Bain", "Boston Consulting Group", "Accenture", "Deloitte", "PwC", "EY", "KPMG", "Slalom", "Thoughtworks", "Publicis Sapient", "Wieden+Kennedy",
  "Ogilvy", "R/GA", "Huge", "VaynerMedia", "WPP", "Dentsu", "Havas", "Edelman",
  // Education & nonprofits
  "Coursera", "Udemy", "Khan Academy", "Chegg", "Quizlet", "MasterClass", "Outschool", "2U", "Teach For America", "Code.org",
  // UK, Canada, Australia
  "Deliveroo", "Ocado", "Gousto", "Cazoo", "Bloom & Wild", "Moonpig", "Skyscanner", "Babylon", "Cleo", "GoCardless", "Thought Machine", "Darktrace", "Improbable",
  "Shopify Canada", "Wealthsimple", "Clio", "Hootsuite", "Lightspeed", "Faire Canada", "Ada", "Cohere Canada", "Atlassian Australia", "Canva Australia", "Airwallex",
  "SafetyCulture", "Culture Amp", "Employment Hero", "Linktree", "Afterpay", "Zip Co", "Xero",
];

export async function discover(deadline: number, perRun = 14) {
  const supa = supabaseAnon();
  const { data: names } = await supa.rpc("discovery_rpc", { secret: ingestSecret(), op: "untried", args: { names: DISCOVERY_SEEDS, limit: perRun } });
  const found: string[] = [];
  for (const name of (names as string[]) || []) {
    if (Date.now() > deadline) break;
    const b = await resolveCompany(name).catch(() => null);
    await supa.rpc("discovery_rpc", { secret: ingestSecret(), op: "mark", args: { name, found: Boolean(b) } });
    if (!b) continue;
    const { data: id } = await supa.rpc("upsert_board", { secret: ingestSecret(), p: { ats: b.ats, token: b.token, name, site: "" } });
    if (id) {
      found.push(`${name} (${b.ats})`);
      await refreshBoard({ ...b, name, id: id as number, site: "" }).catch(() => 0);
    }
  }
  return { tried: ((names as string[]) || []).length, found };
}

/** Re-check every company someone targets, every ~10 minutes, so new postings show up fast. */
export async function refreshTargets(deadline: number) {
  const { data } = await supabaseAnon().rpc("discovery_rpc", { secret: ingestSecret(), op: "target_boards", args: {} });
  let n = 0;
  for (const b of ((data as (Board & { id: number })[]) || []).slice(0, 25)) {
    if (Date.now() > deadline) break;
    n += await refreshBoard(b).catch(() => 0);
  }
  return { boards: ((data as unknown[]) || []).length, jobs: n };
}
