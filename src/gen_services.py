"""One-off generator for the four service-line page sources (edit the output freely)."""
from pathlib import Path

LINES = {
 "engineering": dict(title="Engineering Services", icon="cpu", nav="services",
  lead="Electrical, mechanical and embedded engineering, from first sketch to tested prototype and production-ready documentation.",
  kw="engineering electrical mechanical embedded iot cad pcb controls plc prototype testing design analysis",
  items=[("design","ruler","Design &amp; Analysis","Requirements, concept design, calculations, CAD and simulation so decisions are made on numbers, not guesses.",["Requirements &amp; specifications","3D CAD and drawings","Load, thermal and tolerance analysis"]),
         ("electrical","bolt","Electrical &amp; Controls","Control panels, PLC programming, wiring diagrams and power distribution for machines and facilities.",["Schematics &amp; panel layouts","PLC / HMI programming","Power and protection studies"]),
         ("mechanical","wrench","Mechanical &amp; Product","Enclosures, fixtures, mechanisms and consumer products designed for manufacture and assembly.",["DFM / DFA reviews","Enclosures and fixtures","Bill of materials and sourcing"]),
         ("embedded","cpu","Embedded &amp; IoT","Microcontroller firmware, PCB design and connected devices that report to the cloud.",["PCB schematic and layout","Firmware in C/C++ and Rust","Sensor networks and telemetry"]),
         ("prototyping","flask","Prototyping &amp; Test","Rapid prototypes, test fixtures and validation plans that prove the design before you commit.",["3D printed and machined prototypes","Test plans and reports","Root-cause failure analysis"])]),
 "consulting": dict(title="Technical Consulting", icon="chart", nav="services",
  lead="Independent technical advice that helps you decide what to build, how to build it and how to keep it on schedule.",
  kw="consulting advisory strategy feasibility project management compliance standards training owner's engineer",
  items=[("strategy","chart","Technical Strategy","Technology roadmaps, build-vs-buy decisions and vendor selection grounded in your business goals.",["Technology roadmaps","Build vs. buy analysis","Vendor and tool selection"]),
         ("feasibility","doc","Feasibility Studies","Cost, risk and technical feasibility reviews before you invest in a new product or system.",["Cost and ROI estimates","Risk registers","Go / no-go recommendations"]),
         ("project-management","calendar","Project Management","Owner's-representative and project management services that keep vendors aligned and on budget.",["Schedules and milestones","Vendor coordination","Change and budget control"]),
         ("compliance","shield","Standards &amp; Compliance","Guidance on codes and standards such as NEC, UL, ISO and accessibility requirements.",["Gap assessments","Documentation packages","Audit preparation"]),
         ("training","users","Training &amp; Workshops","Hands-on training for your team on tools, systems and engineering best practices.",["On-site or remote sessions","Custom curriculum","Recorded material for onboarding"])]),
 "software": dict(title="Software &amp; App Development", icon="code", nav="services",
  lead="Custom software, mobile apps and automation that remove manual work and give you better data.",
  kw="software development apps mobile ios android web app automation data cloud devops ai machine learning api integration",
  items=[("custom","code","Custom Software","Web applications, internal tools and APIs built around how your business actually works.",["Web apps and portals","APIs and integrations","Modernizing legacy tools"]),
         ("mobile","mobile","Mobile Apps","Cross-platform iOS and Android apps with offline support, notifications and payments.",["iOS and Android","Offline-first sync","App Store publishing"]),
         ("automation","gear","Automation &amp; Data","Scripts, dashboards and pipelines that connect your systems and cut repetitive work.",["Workflow automation","Dashboards and reporting","Data cleanup and migration"]),
         ("cloud","cloud","Cloud &amp; DevOps","Reliable, secure hosting with CI/CD, monitoring and backups set up properly from day one.",["AWS, Azure and GCP","CI/CD pipelines","Monitoring and backups"]),
         ("ai","layers","AI Integration","Practical AI features such as document processing, chat assistants and smart search.",["Assistants and chatbots","Document and data extraction","Model evaluation and guardrails"])]),
 "web-development": dict(title="Web Development", icon="globe", nav="services",
  lead="Fast, secure WordPress websites and online stores that are easy to update and built to grow with your business.",
  kw="web development website design wordpress woocommerce ecommerce online store hosting maintenance seo speed",
  items=[("sites","globe","Business Websites","Professional, mobile-friendly sites that explain what you do and turn visitors into leads.",["Custom design on a block theme","Lead and quote forms","Analytics set up"]),
         ("ecommerce","cart","E-commerce Stores","WooCommerce stores with Stripe, PayPal, subscriptions, shipping and tax handled.",["Products, services and subscriptions","Stripe and PayPal checkout","Inventory and order emails"]),
         ("wordpress","layers","WordPress Builds","Custom themes, plugins and migrations, built so you can edit pages without a developer.",["Block themes and patterns","Custom plugins","Migrations from Wix or Squarespace"]),
         ("hosting","cloud","Hosting &amp; Care Plans","Managed hosting, updates, backups and security monitoring on a simple monthly plan.",["Daily backups","Plugin and core updates","Uptime and security monitoring"]),
         ("seo","chart","SEO &amp; Performance","Technical SEO, Core Web Vitals and content structure so customers can find you.",["Site speed optimization","Schema and technical SEO","Local search setup"])]),
}

for slug, d in LINES.items():
    cards = "\n".join(f'''    <div class="card" id="{i}">
      <div class="card-icon">{{{{icon:{ic}}}}}</div>
      <h3>{h}</h3>
      <p>{p}</p>
      <ul class="check-list">{"".join(f"<li>{b}</li>" for b in bl)}</ul>
    </div>''' for i, ic, h, p, bl in d["items"])
    plain = d["title"].replace("&amp;", "&")
    body = f'''title: {plain}
heading: {d["title"]}
lead: {d["lead"]}
crumb: Services|services.html
nav: {d["nav"]}
description: {d["lead"]}
keywords: {d["kw"]}
---
<section class="section">
  <div class="wrap">
    <div class="section-head">
      <span class="eyebrow">Capabilities</span>
      <h2>What's included</h2>
      <p class="lead">Engage us for a single task or the whole project. Every engagement starts with a free discovery call and a written proposal.</p>
    </div>
    <div class="grid grid-3">
{cards}
      <div class="card panel">
        <span class="eyebrow">Get started</span>
        <h3>Tell us about your project</h3>
        <p>Share a few details and we'll reply within one business day with questions, a rough budget range and next steps.</p>
        <a class="btn btn-primary" href="contact.html" style="margin-top:auto;align-self:flex-start">Request a Quote {{{{icon:arrow}}}}</a>
      </div>
    </div>
  </div>
</section>
<section class="section section-alt">
  <div class="wrap">
    <div class="section-head center"><span class="eyebrow">Engagement models</span><h2>Pick how you want to work</h2></div>
    <div class="grid grid-3">
      <div class="card"><div class="card-icon">{{{{icon:doc}}}}</div><h3>Fixed-price project</h3><p>Defined scope, milestones and a firm price. Best when requirements are clear.</p></div>
      <div class="card"><div class="card-icon">{{{{icon:clock}}}}</div><h3>Time &amp; materials</h3><p>Hourly or daily rate with weekly reporting. Best for R&amp;D and evolving scope.</p></div>
      <div class="card"><div class="card-icon">{{{{icon:calendar}}}}</div><h3>Monthly retainer</h3><p>Reserved hours each month for ongoing improvements, support and advice.</p></div>
    </div>
  </div>
</section>
'''
    Path(f"src/pages/{slug}.html").write_text(body)
print("ok")
