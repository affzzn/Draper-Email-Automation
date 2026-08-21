// Parser regression test — locks the parser against the REAL Rightmove / Zoopla lead
// formats (sales + lettings, all layouts) so a portal template tweak or a code change
// can't silently drop a field again. Run: npm run test:parse
//
// The fixtures below are lightly-trimmed real emails (footers removed). Each asserts the
// fields the pipeline actually depends on: name, email, phone, property (ref/address),
// and the applicant's message. If any assertion fails the script exits non-zero.

import { parseMessage } from "../src/lib/parse";
import type { GraphMessage } from "../src/lib/graph";

const relay = (name: string, address: string) => ({ emailAddress: { name, address } });

interface Case {
  label: string;
  msg: GraphMessage;
  expect: {
    source?: string;
    name?: string | null;
    email?: string;
    phone?: string | null;
    ref?: string | null;
    addressIncludes?: string; // substring the parsed address must contain
    messageIncludes?: string | null; // substring the parsed message must contain (null = must be null)
    parseStatus?: string;
  };
}

const cases: Case[] = [
  {
    label: "Zoopla LETTINGS (Carlota, label-on-next-line layout)",
    msg: {
      id: "z-carlota",
      subject: "Tenant enquiry from Carlota Apolonia via Zoopla",
      from: relay("Zoopla", "members@zoopla.co.uk"),
      body: {
        contentType: "text",
        content:
          "Zoopla\nTenant enquiry\nDear team at Draper London,\nYou have a new Tenant enquiry\n" +
          "Name:\n\nCarlota Apolonia\nTelephone:\n\n07384 553134\nEmail:\n\ncarlota.apolonia@gmail.com\n" +
          "Type of enquiry:\n\nOrganise a viewing\nUnique Reference:\n\nlisting_180625173_164621\n" +
          "Your property ref:\n\n34696037\nAddress:\n\nGrove Hall Court, Hall Road, St Johns Wood NW8\n" +
          "Message:\n\nGood morning! I am a Masters Student, starting work in September. My current lease ends 14 August 2026. I am interested in viewing this property, as well as any other 1B1B flats at a maximum of 3,000pcm.\n" +
          "Type of property:\n\nStudio and 1 bedroom properties\nPrice range:\n\nUp to £3,000 per month\nRegards, The Zoopla Team",
      },
    },
    expect: {
      source: "zoopla",
      name: "Carlota Apolonia",
      email: "carlota.apolonia@gmail.com",
      phone: "07384 553134",
      addressIncludes: "Hall Road",
      messageIncludes: "Masters Student",
      parseStatus: "full",
    },
  },
  {
    label: "Zoopla SALES (Kate, label-on-next-line layout)",
    msg: {
      id: "z-kate",
      subject: "Buyer enquiry from Kate Love via Zoopla",
      from: relay("Zoopla", "members@zoopla.co.uk"),
      body: {
        contentType: "text",
        content:
          "Zoopla\nBuyer enquiry\nName:\n\nKate Love\nTelephone:\n\n07513 343968\nEmail:\n\nkatemarie.love@gmail.com\n" +
          "Type of enquiry:\n\nOrganise a viewing\nUnique Reference:\n\nlisting_178791227_164621\n" +
          "Your property ref:\n\n34337174\nAddress:\n\nCumberland House, Clifton Gardens, Little Venice W9\n" +
          "Postcode:\n\nSw10 0bq\nType of property:\n\n3+ bedroom property\nPrice range:\n\nUp to £2,500,000\n" +
          "Interested in:\n\nHas a garden\nRegards, The Zoopla Team",
      },
    },
    expect: {
      source: "zoopla",
      name: "Kate Love",
      email: "katemarie.love@gmail.com",
      phone: "07513 343968",
      addressIncludes: "Clifton Gardens",
      parseStatus: "full",
    },
  },
  {
    label: "Zoopla LETTINGS (Oksana, inline layout, DRL ref)",
    msg: {
      id: "z-oksana",
      subject: "Tenant enquiry via Zoopla",
      from: relay("Zoopla", "members@zoopla.co.uk"),
      body: {
        contentType: "text",
        content:
          "Zoopla\nTenant enquiry\nName: Oksana Fedoseyeva\nTelephone: 07717 741050\nEmail: Oksana@vostockcapital.com\n" +
          "Type of enquiry: Looking to rent\nUnique Reference: listing_183127578_164621\n" +
          "Your property ref: 164621_DRL260149_L\nAddress: Belmont Street, London NW1\n" +
          "Message:\n\nIs this property still available?\nType of property: Houses and flats\nRegards, The Zoopla Team",
      },
    },
    expect: {
      source: "zoopla",
      name: "Oksana Fedoseyeva",
      email: "Oksana@vostockcapital.com",
      phone: "07717 741050",
      ref: "164621_DRL260149_L",
      addressIncludes: "Belmont Street",
      messageIncludes: "still available",
      parseStatus: "full",
    },
  },
  {
    label: "Rightmove SALES (Godfrey St, semicolon machine-line)",
    msg: {
      id: "r-godfrey",
      subject: "Rightmove Lead: Affan Imran",
      from: relay("Rightmove", "noreply@rightmove.co.uk"),
      body: {
        contentType: "text",
        content:
          "Rightmove\nContact details\nAffan Imran\naffan1708@gmail.com\n07918435307\n" +
          "4 bed house for sale\n47, Godfrey Street, Chelsea, London, SW3, SW3 3SX\n£3,250,000\n83517_DRL260226\n" +
          "Name:Affan Imran; Address:Manchester, M12 9LR; Email:affan1708@gmail.com; Phone:07918435307; " +
          "Requirements: Wants more details on this property; Wants to view this property; PropDescription:4 bed house for sale; " +
          "PropAddress:47, Godfrey Street, Chelsea, London, SW3, SW3 3SX; PropPrice:£3,250,000; PropStatus:Available; " +
          "PropReference:83517_DRL260226; Comments:Hi, can I view this property pleaSE?; Branch:Draper London, London\n© Rightmove Group Limited",
      },
    },
    expect: {
      source: "rightmove",
      name: "Affan Imran",
      email: "affan1708@gmail.com",
      phone: "07918435307",
      ref: "83517_DRL260226",
      addressIncludes: "Godfrey Street",
      messageIncludes: "can I view this property",
      parseStatus: "full",
    },
  },
  {
    label: "Rightmove LETTINGS (South Lodge, Enquiry Manager format)",
    msg: {
      id: "r-southlodge",
      subject: "",
      from: relay("Rightmove", "noreply@rightmove.co.uk"),
      body: {
        contentType: "text",
        content:
          "Hi, Affan has enquired about this property\nFLAT 33, SOUTH LODGE, Circus Road, London, NW8, NW8 9ES\n£9,000 pcm • 4 bed\n" +
          "Affan Imran\naffan@innateaiconsulting.com\n7918435307\nFlat 1 Room A, Block B, 78 Grafton Street, Manchester, M13 9LR\n" +
          "MOVING DATE Within 1 month\nDURATION Over 24 months\nMOVING WITH Family\nEMPLOYMENT Self-employed\n" +
          "MESSAGE FROM APPLICANT\nim interested to view this property asap\nSOFT CREDIT CHECK CONSENT\nYes\n" +
          "APPLICANT WOULD LIKE\nMore details on this property\nBook a viewing\n© Rightmove Group Limited",
      },
    },
    expect: {
      source: "rightmove",
      name: "Affan Imran",
      email: "affan@innateaiconsulting.com",
      phone: "7918435307",
      addressIncludes: "SOUTH LODGE",
      messageIncludes: "interested to view this property asap",
      parseStatus: "full",
    },
  },
  {
    label: "Rightmove LETTINGS (Virginia, Enquiry Manager format)",
    msg: {
      id: "r-virginia",
      subject: "",
      from: relay("Rightmove", "noreply@rightmove.co.uk"),
      body: {
        contentType: "text",
        content:
          "Hi, Virginia has enquired about this property\n145, Ledbury Road, Notting Hill, London, W11, W11 1HR\n£2,250 pcm • 1 bed\n" +
          "Virginia Stratford\nv.stratford@gmail.com\n14156942440\n29 Bridstow W2 5AE\n" +
          "MOVING DATE Within 3 months\nDURATION 12 months\nMOVING WITH Myself\n" +
          "MESSAGE FROM APPLICANT\nHello, what floor is this flat on?\nAPPLICANT WOULD LIKE\nMore details on this property\n© Rightmove Group Limited",
      },
    },
    expect: {
      source: "rightmove",
      name: "Virginia Stratford",
      email: "v.stratford@gmail.com",
      phone: "14156942440",
      addressIncludes: "Ledbury Road",
      messageIncludes: "what floor is this flat on",
      parseStatus: "full",
    },
  },
  {
    // Regression: message ends with a sign-off word ("Thanks") and the next line is an
    // ALL-CAPS section header. Must NOT become the name ("Dear APPLICANT").
    label: "Rightmove LETTINGS (EBINYU, Enquiry Manager, message ends 'Thanks')",
    msg: {
      id: "r-ebinyu",
      subject: "Lettings enquiry: Oberman Road - Tenant from NW8",
      from: relay("Rightmove", "noreply@rightmove.co.uk"),
      body: {
        contentType: "text",
        content:
          "Hi, EBINYU has enquired about this property\nFLAT 39, JOSEPHINE HOUSE, 10, Josephine House, Willesden, London, NW10, NW10 1EF\n£2,250 pcm • 2 bed\n" +
          "EBINYU Faloughi\nbebifal4@gmail.com\n7512635695\nNeville court, NW8 9DD\n" +
          "MOVING DATE Within 1 month\nDURATION 18 months\nEMPLOYMENT Full time employed\n" +
          "MESSAGE FROM APPLICANT\nHi , I wanted to confirm whether parking is included in the asking price. Thanks\n" +
          "APPLICANT WOULD LIKE\nMore details on this property\nBook a viewing\n© Rightmove Group Limited",
      },
    },
    expect: {
      source: "rightmove",
      name: "EBINYU Faloughi",
      email: "bebifal4@gmail.com",
      addressIncludes: "JOSEPHINE HOUSE",
      messageIncludes: "parking is included",
      parseStatus: "full",
    },
  },
  {
    // Regression: message ends "many thanks" and the next section is SOFT CREDIT CHECK
    // CONSENT. Must NOT become the name ("Dear SOFT").
    label: "Rightmove LETTINGS (Sam, Enquiry Manager, message ends 'many thanks')",
    msg: {
      id: "r-sam",
      subject: "",
      from: relay("Rightmove", "noreply@rightmove.co.uk"),
      body: {
        contentType: "text",
        content:
          "Hi, Sam has enquired about this property\nFLAT 33, SOUTH LODGE, Circus Road, London, NW8, NW8 9ES\n£9,000 pcm • 4 bed\n" +
          "Sam Patel\nsam.patel@gmail.com\n7911223344\n" +
          "MESSAGE FROM APPLICANT\nKeen to view this asap, many thanks\nSOFT CREDIT CHECK CONSENT\nYes\n" +
          "APPLICANT WOULD LIKE\nBook a viewing\n© Rightmove Group Limited",
      },
    },
    expect: {
      source: "rightmove",
      name: "Sam Patel",
      email: "sam.patel@gmail.com",
      addressIncludes: "SOUTH LODGE",
      messageIncludes: "Keen to view",
      parseStatus: "full",
    },
  },
  {
    label: "Rightmove SALES (Gerard, semicolon format) -> Dear Gerard",
    msg: {
      id: "r-gerard",
      subject: "Sales enquiry: Harvist Road - Buyer from W9",
      from: relay("Rightmove", "noreply@rightmove.co.uk"),
      body: {
        contentType: "text",
        content:
          "Rightmove Lead: Gerard Crichlow\nContact details\nGerard Crichlow\ngcrichlow9@gmail.com\n07525823423\n" +
          "3 bed Apartment for sale\n119C, Harvist Road, Queen's Park, London, NW6, NW6 6HA\n£1,100,000\n83517_DRL260189\n" +
          "Additional Comments\nHello interested in viewing the property\n" +
          "Name:Gerard Crichlow; Email:gcrichlow9@gmail.com; Phone:07525823423; PropAddress:119C, Harvist Road, Queen's Park, London, NW6, NW6 6HA; PropReference:83517_DRL260189; Comments:Hello interested in viewing the property\n© Rightmove Group Limited",
      },
    },
    expect: {
      source: "rightmove",
      name: "Gerard Crichlow",
      email: "gcrichlow9@gmail.com",
      ref: "83517_DRL260189",
      addressIncludes: "Harvist Road",
      parseStatus: "full",
    },
  },
  {
    // No regression: a GENUINE signed name (mixed-case) must still win over a malformed
    // labelled field ("Viola And") — the deliberate "prefer the signed name" behaviour.
    label: "Genuine signature still wins over a malformed label",
    msg: {
      id: "nikos",
      subject: "Enquiry",
      from: relay("Zoopla", "members@zoopla.co.uk"),
      body: {
        contentType: "text",
        content:
          "Zoopla\nName: Viola And\nAddress: Some Street, London W9\n" +
          "Message:\nI would like to view this property please.\n\nKind regards,\nNikos Kousiaris",
      },
    },
    expect: { name: "Nikos Kousiaris" },
  },
];

let failures = 0;
function check(label: string, field: string, actual: unknown, cond: boolean) {
  if (!cond) {
    failures++;
    console.log(`  ✗ ${field}: got ${JSON.stringify(actual)}`);
  }
}

for (const c of cases) {
  console.log(`\n${c.label}`);
  const p = parseMessage(c.msg);
  const e = c.expect;
  if (e.source !== undefined) check(c.label, "source", p.source, p.source === e.source);
  if (e.name !== undefined) check(c.label, "name", p.applicantName, p.applicantName === e.name);
  if (e.email !== undefined)
    check(c.label, "email", p.applicantEmail, (p.applicantEmail ?? "").toLowerCase() === e.email.toLowerCase());
  if (e.phone !== undefined) check(c.label, "phone", p.applicantPhone, p.applicantPhone === e.phone);
  if (e.ref !== undefined) check(c.label, "ref", p.propertyReference, p.propertyReference === e.ref);
  if (e.addressIncludes !== undefined)
    check(c.label, "address", p.propertyAddress, !!p.propertyAddress && p.propertyAddress.includes(e.addressIncludes));
  if (e.messageIncludes !== undefined) {
    if (e.messageIncludes === null) check(c.label, "message", p.messageBody, p.messageBody === null);
    else check(c.label, "message", p.messageBody, !!p.messageBody && p.messageBody.includes(e.messageIncludes));
  }
  if (e.parseStatus !== undefined) check(c.label, "parseStatus", p.parseStatus, p.parseStatus === e.parseStatus);
  console.log(
    `  name=${JSON.stringify(p.applicantName)} email=${JSON.stringify(p.applicantEmail)} phone=${JSON.stringify(p.applicantPhone)} ref=${JSON.stringify(p.propertyReference)}`
  );
  console.log(`  address=${JSON.stringify(p.propertyAddress)}`);
  console.log(`  message=${JSON.stringify(p.messageBody)} [${p.parseStatus}]`);
}

console.log(failures === 0 ? "\n✅ All parser fixtures pass." : `\n❌ ${failures} assertion(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
