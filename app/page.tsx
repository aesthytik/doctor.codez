import About from "@/components/About";
import Experience from "@/components/Experience";
import overrides from "@/data/overrides.json";
import { facts, published } from "@/lib/data/career";
import { celebrationSetting, versionOf } from "@/lib/data/publish";
import { answers, structuredData } from "@/lib/structured-data";

export default function Home() {
  const faq = answers(facts, overrides.countingRule);
  return (
    <>
      {/* What the page is, for search engines. "<" is escaped so no text can close the tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData(facts, faq)).replace(/</g, "\\u003c") }} />
      {/* Only what the page draws is sent to the browser. */}
      <Experience goals={published.goals} venues={published.venues} version={versionOf(published)} celebration={celebrationSetting(overrides)}>
        <About facts={facts} faq={faq} />
      </Experience>
    </>
  );
}
