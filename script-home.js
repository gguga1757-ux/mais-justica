const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

window.addEventListener("load", () => {
  const preloader = $("#preloader");

  setTimeout(() => {
    if (preloader) {
      preloader.classList.add("hidden");
      setTimeout(() => {
        preloader.style.display = "none";
      }, 700);
    }

    document.body.classList.add("loaded");
    revealInitial();
    animateCounters();
    animateRiskRing();
  }, 1200);
});

function revealInitial() {
  $$("[data-reveal], .reveal").forEach((el, i) => {
    setTimeout(() => {
      el.classList.add("visible");
    }, i * 90);
  });

  const dash = $("#dashMockup");
  if (dash) {
    setTimeout(() => dash.classList.add("visible"), 500);
  }
}

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("visible");
    revealObserver.unobserve(entry.target);
  });
}, {
  threshold: 0.15
});

$$(".reveal").forEach((el) => revealObserver.observe(el));

function animateCounters() {
  $$("[data-count]").forEach((counter) => {
    const target = Number(counter.dataset.count || 0);
    let current = 0;
    const step = Math.max(1, Math.ceil(target / 70));

    const timer = setInterval(() => {
      current += step;

      if (current >= target) {
        counter.textContent = target >= 800 ? `+${target}` : target;
        clearInterval(timer);
      } else {
        counter.textContent = target >= 800 ? `+${current}` : current;
      }
    }, 24);
  });
}

function animateRiskRing() {
  const ring = $("#riskRing");
  const pct = $("#riskPct");

  if (!ring || !pct) return;

  const target = 80;
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (target / 100) * circumference;

  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference;

  setTimeout(() => {
    ring.style.strokeDashoffset = offset;
  }, 500);

  let current = 0;
  const timer = setInterval(() => {
    current += 2;
    pct.textContent = `${current}%`;

    if (current >= target) {
      pct.textContent = `${target}%`;
      clearInterval(timer);
    }
  }, 25);
}

document.addEventListener("mousemove", (e) => {
  const cursor = $("#cursor");
  const follower = $("#cursor-follower");

  if (cursor) {
    cursor.style.left = `${e.clientX}px`;
    cursor.style.top = `${e.clientY}px`;
  }

  if (follower) {
    follower.animate(
      { left: `${e.clientX}px`, top: `${e.clientY}px` },
      { duration: 350, fill: "forwards" }
    );
  }

  moveParallax(e);
});

function moveParallax(e) {
  const hero = $("#hero");
  const dash = $("#dashMockup");

  if (!hero || !dash) return;

  const rect = hero.getBoundingClientRect();
  const x = (e.clientX - rect.left - rect.width / 2) / rect.width;
  const y = (e.clientY - rect.top - rect.height / 2) / rect.height;

  dash.style.transform = `
    translate3d(${x * 28}px, ${y * 18}px, 0)
    rotateX(${y * -4}deg)
    rotateY(${x * 6}deg)
  `;

  const orb1 = $(".orb-1");
  const orb2 = $(".orb-2");
  const orb3 = $(".orb-3");
  const orb4 = $(".orb-4");

  if (orb1) orb1.style.transform = `translate3d(${x * -35}px, ${y * -25}px, 0)`;
  if (orb2) orb2.style.transform = `translate3d(${x * 30}px, ${y * 20}px, 0)`;
  if (orb3) orb3.style.transform = `translate3d(${x * -18}px, ${y * 28}px, 0)`;
  if (orb4) orb4.style.transform = `translate3d(${x * 22}px, ${y * -18}px, 0)`;
}

$$(".magnetic").forEach((btn) => {
  btn.addEventListener("mousemove", (e) => {
    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;

    btn.style.transform = `translate(${x * 0.18}px, ${y * 0.18}px)`;
  });

  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "translate(0, 0)";
  });
});

$$(".tilt-card").forEach((card) => {
  card.addEventListener("mousemove", (e) => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const rotateY = ((x / rect.width) - 0.5) * 8;
    const rotateX = ((y / rect.height) - 0.5) * -8;

    card.style.transform = `
      perspective(900px)
      rotateX(${rotateX}deg)
      rotateY(${rotateY}deg)
      translateY(-4px)
    `;
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "";
  });
});

window.addEventListener("scroll", () => {
  const header = $("#header");
  const floatingCta = $("#floatingCta");
  const cta = $("#cta");

  if (header) {
    header.classList.toggle("scrolled", window.scrollY > 60);
  }

  if (floatingCta) {
    floatingCta.classList.toggle("visible", window.scrollY > 420);

    if (cta) {
      const rect = cta.getBoundingClientRect();
      const inCta = rect.top < window.innerHeight && rect.bottom > 0;
      floatingCta.classList.toggle("hidden", inCta);
    }
  }
});

window.toggleFaq = function (el) {
  const item = el.parentElement;
  const isOpen = item.classList.contains("open");

  $$(".faq-item").forEach((faq) => faq.classList.remove("open"));

  if (!isOpen) {
    item.classList.add("open");
  }
};

$$('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (e) => {
    const target = $(link.getAttribute("href"));

    if (!target) return;

    e.preventDefault();
    target.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });
});

const trustTrack = $(".trust-track");

if (trustTrack) {
  trustTrack.addEventListener("mouseenter", () => {
    trustTrack.style.animationPlayState = "paused";
  });

  trustTrack.addEventListener("mouseleave", () => {
    trustTrack.style.animationPlayState = "running";
  });
}

