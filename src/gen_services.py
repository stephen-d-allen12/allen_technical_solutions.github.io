"""One-off generator for the four service-line page sources (edit the output freely)."""
from pathlib import Path

LINES = {
 "engineering": dict(title="Engineering Services", icon="cpu", nav="services",
  lead="Electronics and embedded engineering, real-time test systems and product validation, grounded in deep controls and test engineering experience.",
  kw="engineering electronics embedded controls real-time test automation hil simulation calibration data acquisition daq instrumentation linux validation prototype pcb design analysis",
  items=[("electronics","bolt","Electronics","Circuit and PCB design, wiring and power distribution, and electronic hardware for products and test equipment.",["Schematics and PCB layout","Wiring harnesses and diagrams","Power and protection design"]),
         ("embedded","cpu","Embedded Controls &amp; IoT","Low-level and advanced control software, firmware and connected devices, built to ISO and IEC standards.",["Control strategy and firmware","Sensor networks and telemetry","Release and change management"]),
         ("realtime","layers","Real-Time &amp; Linux Systems","Hardware-agnostic, real-time control platforms on Linux with industrial communications and custom I/O.",["Real-time test-cell controls","Industrial communications and custom I/O","Machine safety integration"]),
         ("test-automation","gear","Test Automation, HIL &amp; Data Acquisition","Automated test environments, hardware-in-the-loop simulators and data acquisition systems that find problems before the field does.",["HIL and vehicle simulators","Closed-loop test automation","Field data loggers and instrumentation"]),
         ("validation","flask","Design, Prototyping &amp; Validation","Requirements, design analysis, rapid prototypes, calibration and validation plans that prove the design before you commit.",["Requirements and design analysis","Prototypes and calibration","Validation and failure analysis"])]),
 "consulting": dict(title="Technical Consulting", icon="chart", nav="services",
  lead="Independent technical advice and engineering leadership on demand, backed by experience leading global controls teams and complex programs.",
  kw="consulting advisory strategy feasibility program project management requirements specifications compliance standards functional safety cybersecurity iso iec six sigma training mentoring process improvement",
  items=[("strategy","chart","Strategy &amp; Feasibility","Technology roadmaps, build-vs-buy decisions, and cost, risk and feasibility reviews before you invest.",["Architecture and technology roadmaps","Cost, risk and ROI estimates","Go / no-go recommendations"]),
         ("requirements","book","Requirements &amp; Specifications","Turning customer and OEM needs into clear technical requirements and specifications your team can build to.",["Customer and OEM requirements","Technical specifications","Design reviews"]),
         ("project-management","calendar","Program &amp; Project Management","Owner's-representative and project leadership that keeps scope, schedule, releases and vendors aligned.",["Schedules, milestones and releases","Cross-functional and global teams","Risk, change and budget control"]),
         ("safety","shield","Safety, Standards &amp; Compliance","Functional safety, cybersecurity and standards guidance (ISO, IEC, UL and NEC) for products, software and websites.",["Safety concept and cybersecurity reviews","Gap assessments and documentation","Audit preparation"]),
         ("training","users","Training &amp; Process Improvement","Hands-on training for your team and Six Sigma-style improvement of engineering, test and release processes.",["On-site or remote training","Process mapping and metrics","Release-process improvement"])]),
 "software": dict(title="Software &amp; App Development", icon="code", nav="services",
  lead="Custom software, mobile apps and automation that remove manual work and give you better data, fully tested before release.",
  kw="software development apps mobile ios android web app automation data dashboards integration api",
  items=[("custom","code","Custom Software","Web applications, internal tools and APIs built around how your business actually works.",["Web apps and portals","APIs and integrations","Modernizing legacy tools"]),
         ("mobile","mobile","Mobile Apps","Cross-platform iOS and Android apps with offline support, notifications and payments.",["iOS and Android","Offline-first sync","App Store publishing"]),
         ("automation","gear","Automation &amp; Data","Scripts, dashboards, integrations and search tools that connect your systems and cut repetitive work.",["Workflow automation","Dashboards and reporting","Document processing and data cleanup"])]),
 "web-development": dict(title="Web Development", icon="globe", nav="services",
  lead="Websites for churches, individuals, organizations and businesses of any size. Fast, secure and easy to update, with care plans that keep them that way.",
  kw="web development website design church ministry personal portfolio organization nonprofit club community business wordpress woocommerce ecommerce online store care plan maintenance seo speed",
  items=[("church","church","Church Websites","Welcoming church and ministry sites with service times, sermons, events and online giving.",["Service times, events and directions","Sermon audio and video","Online giving and sign-ups"]),
         ("personal","user","Personal &amp; Organization Websites","Sites for individuals, clubs, nonprofits and community groups that share your story and keep members informed.",["Portfolios, resumes and blogs","Member news and event calendars","Donation and contact forms"]),
         ("business","globe","Business Websites &amp; Online Stores","Professional business sites and WooCommerce stores that turn visitors into customers.",["Lead and quote forms","Stripe and PayPal checkout","Built on WordPress so you can edit it yourself"]),
         ("care","shield","Care Plans &amp; SEO","Updates, backups, security monitoring and SEO on a simple monthly plan, so your site stays fast and easy to find.",["Core and plugin updates with daily backups","Uptime and security monitoring","Site speed and local search setup"])]),
}

for slug, d in LINES.items():
    cards = "\n".join(f'''    <div class="card" id="{i}">
      <div class="card-icon">{{{{icon:{ic}}}}}</div>
      <h3>{h}</h3>
      <p>{p}</p>
      <ul class="check-list">{"".join(f"<li>{b}</li>" for b in bl)}</ul>
    </div>''' for i, ic, h, p, bl in d["items"])
    # let the "Get started" panel fill out the last row of the 3-column grid
    span = {0: " span-all", 1: " span-2", 2: ""}[len(d["items"]) % 3]
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
      <div class="card panel{span}">
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
