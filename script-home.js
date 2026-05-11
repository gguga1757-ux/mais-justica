const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

document.addEventListener("DOMContentLoaded", () => {
  initPreloader();
  initReveal();
  initCounters();
  initRiskRing();
  initCursorAndParallax();
  initMagneticButtons();
  initTiltCards();
  initHeaderAndFloatingCTA();
  initSmoothScroll();
  initFAQ();
  initTrustTrack();
  initContactForm();
});

/* PRELOADER */
function initPreloader() {
  const preloader = $("#preloader");

  window.addEventListener("load", () => {
    setTimeout(() => {
      if (preloader) {
        preloader.classList.add("hidden");

        setTimeout(() => {
          preloader.style.display = "none";
        }, 700);
      }

      document.body.classList.add("loaded");
    }, 900);
  });

  setTimeout(() => {
    if (preloader) {
      preloader.classList.add("hidden");

      setTimeout(() => {
        preloader.style.display = "none";
      }, 700);
    }

    document.body.classList.add("loaded");
  }, 3000);
}

/* SCROLL REVEAL */
function initReveal() {
  const revealItems = $$("[data-reveal], .reveal");

  revealItems.forEach((el, i) => {
    if (window.scrollY < 20 && el.getBoundingClientRect().top < window.innerHeight) {
      setTimeout(() => {
        el.classList.add("visible");
      }, i * 80);
    }
  });

  if (!("IntersectionObserver" in window)) {
    revealItems.forEach((el) => el.classList.add("visible"));
    return;
  }

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const delay = entry.target.style.getPropertyValue("--delay") || "0s";
      entry.target.style.transitionDelay = delay;
      entry.target.classList.add("visible");
      revealObserver.unobserve(entry.target);
    });
  }, {
    threshold: 0.14,
    rootMargin: "0px 0px -40px 0px"
  });

  revealItems.forEach((el) => revealObserver.observe(el));
}

/* COUNTERS */
function initCounters() {
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

/* RISK RING */
function initRiskRing() {
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

/* CUSTOM CURSOR + PARALLAX */
function initCursorAndParallax() {
  const cursor = $("#cursor");
  const follower = $("#cursor-follower");

  if (!cursor || !follower || window.innerWidth <= 960) return;

  let mouseX = 0;
  let mouseY = 0;
  let followerX = 0;
  let followerY = 0;

  document.addEventListener("mousemove", (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    cursor.style.left = `${mouseX}px`;
    cursor.style.top = `${mouseY}px`;

    moveParallax(e);
  });

  function animateFollower() {
    followerX += (mouseX - followerX) * 0.16;
    followerY += (mouseY - followerY) * 0.16;

    follower.style.left = `${followerX}px`;
    follower.style.top = `${followerY}px`;

    requestAnimationFrame(animateFollower);
  }

  animateFollower();

  $$("a, button, .btn, input, textarea, select").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      cursor.classList.add("cursor-active");
      follower.classList.add("cursor-active");
    });

    el.addEventListener("mouseleave", () => {
      cursor.classList.remove("cursor-active");
      follower.classList.remove("cursor-active");
    });
  });
}

function moveParallax(e) {
  const hero = $("#hero") || $(".hero") || $(".about-hero") || $(".contact-hero") || $(".privacy-hero") || $(".terms-hero");
  const dash = $("#dashMockup") || $(".db3d");

  if (!hero) return;

  const rect = hero.getBoundingClientRect();
  const x = (e.clientX - rect.left - rect.width / 2) / rect.width;
  const y = (e.clientY - rect.top - rect.height / 2) / rect.height;

  if (dash) {
    dash.style.transform = `
      perspective(1400px)
      translate3d(${x * 18}px, ${y * 12}px, 0)
      rotateX(${7 + y * -3}deg)
      rotateY(${-10 + x * 5}deg)
    `;
  }

  const orb1 = $(".orb-1");
  const orb2 = $(".orb-2");
  const orb3 = $(".orb-3");
  const orb4 = $(".orb-4");

  if (orb1) orb1.style.transform = `translate3d(${x * -35}px, ${y * -25}px, 0)`;
  if (orb2) orb2.style.transform = `translate3d(${x * 30}px, ${y * 20}px, 0)`;
  if (orb3) orb3.style.transform = `translate3d(${x * -18}px, ${y * 28}px, 0)`;
  if (orb4) orb4.style.transform = `translate3d(${x * 22}px, ${y * -18}px, 0)`;
}

/* MAGNETIC BUTTONS */
function initMagneticButtons() {
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
}

/* TILT CARDS */
function initTiltCards() {
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
}

/* HEADER + FLOATING CTA */
function initHeaderAndFloatingCTA() {
  const header = $("#header");
  const floatingCta = $("#floatingCta");
  const cta = $("#cta");

  function updateScrollElements() {
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
  }

  updateScrollElements();
  window.addEventListener("scroll", updateScrollElements);
}

/* SMOOTH SCROLL */
function initSmoothScroll() {
  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (!href || href === "#") return;

      const target = $(href);
      if (!target) return;

      e.preventDefault();

      const offset = href === "#cta" ? 160 : 110;
      const top = target.getBoundingClientRect().top + window.pageYOffset - offset;

      window.scrollTo({
        top,
        behavior: "smooth"
      });
    });
  });
}

/* FAQ ACCORDION */
function initFAQ() {
  $$(".faq-q").forEach((question) => {
    question.addEventListener("click", () => {
      toggleFaq(question);
    });

    question.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleFaq(question);
      }
    });
  });
}

function toggleFaq(question) {
  const item = question.closest(".faq-item");
  if (!item) return;

  const isOpen = item.classList.contains("open");

  $$(".faq-item").forEach((faq) => {
    faq.classList.remove("open");
  });

  if (!isOpen) {
    item.classList.add("open");
  }
}

/* TRUST BAR */
function initTrustTrack() {
  const trustTrack = $(".trust-track");

  if (!trustTrack) return;

  trustTrack.addEventListener("mouseenter", () => {
    trustTrack.style.animationPlayState = "paused";
  });

  trustTrack.addEventListener("mouseleave", () => {
    trustTrack.style.animationPlayState = "running";
  });
}

/* CONTACT FORM */
function initContactForm() {
  const contactForm = $(".contact-form");
  const whatsappInput = $("#whatsapp");
  const contactApiBase =
    window.MAIS_JUSTICA_API_BASE || "https://mais-justica-api.onrender.com";

  if (whatsappInput) {
    whatsappInput.addEventListener("input", (e) => {
      let value = e.target.value.replace(/\D/g, "");

      if (value.length > 11) value = value.slice(0, 11);

      if (value.length > 10) {
        value = value.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
      } else if (value.length > 6) {
        value = value.replace(/^(\d{2})(\d{4})(\d{0,4})$/, "($1) $2-$3");
      } else if (value.length > 2) {
        value = value.replace(/^(\d{2})(\d{0,5})$/, "($1) $2");
      } else if (value.length > 0) {
        value = value.replace(/^(\d*)$/, "($1");
      }

      e.target.value = value;
    });
  }

  if (!contactForm || contactForm.dataset.secureHandler === "true") return;

  contactForm.dataset.secureHandler = "true";

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const submitButton = contactForm.querySelector('button[type="submit"]');
    const formData = new FormData(contactForm);

    const data = {
      nome: formData.get("nome"),
      email: formData.get("email"),
      whatsapp: formData.get("whatsapp"),
      assunto: formData.get("assunto"),
      mensagem: formData.get("mensagem"),
      website: formData.get("website") || "",
    };

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Enviando...";
      submitButton.style.opacity = "0.75";
    }

    try {
      const res = await fetch(`${contactApiBase}/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) throw new Error("contact_failed");

      alert("Mensagem enviada com sucesso!");
      contactForm.reset();
    } catch (_err) {
      alert("Nao foi possivel enviar agora. Tente novamente em alguns minutos.");
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Enviar mensagem ->";
        submitButton.style.opacity = "1";
      }
    }
  });
}
