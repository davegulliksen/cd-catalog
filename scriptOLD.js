// ===============================
// SHARED CART HELPERS (LOCAL ONLY)
// ===============================
function getCart() {
  return JSON.parse(localStorage.getItem("cart")) || [];
}

function setCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
  document.dispatchEvent(new Event("cart-updated"));
}

// ===============================
// UI HELPERS FOR CATALOG + CART BUTTON
// ===============================
function updateCartButton() {
  const btn = document.getElementById("cart-button");
  if (!btn) return;

  const cart = getCart();
  if (cart.length > 0) {
    btn.textContent = `Cart (${cart.length}) • Ready to check out`;
  } else {
    btn.textContent = `Cart (0)`;
  }
}

function updateAddToCartButtons() {
  const cart = getCart();
  const cartIds = new Set(cart.map(item => item.CatalogNumber));

  document.querySelectorAll(".add-to-cart").forEach(btn => {
    const cdId = btn.dataset.id;

    if (cartIds.has(cdId)) {
      btn.textContent = "In the Cart";
      btn.classList.add("disabled-btn");
      btn.disabled = true;
    } else {
      btn.textContent = "Add to Cart";
      btn.classList.remove("disabled-btn");
      btn.disabled = false;
    }
  });
}

// React to any cart change (from this file or cart.js)
document.addEventListener("cart-updated", () => {
  updateAddToCartButtons();
  updateCartButton();
});

// ===============================
// CATALOG + FILTER + BUTTON WIRING
// ===============================
// ===============================
// CATALOG + FILTER + BUTTON WIRING (Updated for JSONL)
// ===============================
fetch('catalog.jsonl') // Make sure this matches your new filename on GitHub
  .then(response => response.text())
  .then(text => {
    const container = document.getElementById('catalog');
    const seriesFilter = document.getElementById('seriesFilter');

    // Convert JSONL text into an array of objects
    const cds = text.split('\n')
      .filter(line => line.trim() !== '') // Remove empty lines
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          console.error("Skipping broken line:", line);
          return null;
        }
      })
      .filter(cd => cd !== null); // Filter out any lines that failed to parse

    // Extract unique series names (alphabetical)
    const seriesList = [...new Set(cds.map(cd => cd.Series))]
      .sort((a, b) => a.localeCompare(b));

    // Populate dropdown
    seriesList.forEach(series => {
      const opt = document.createElement('option');
      opt.value = series;
      opt.textContent = series;
      seriesFilter.appendChild(opt);
    });

    // Confirmation animation (same as before)
    function showAddConfirmation(cdId) {
      const card = document.querySelector(`.cd.card[data-id="${cdId}"]`);
      if (!card) return;
      const confirmEl = card.querySelector('.add-confirmation');
      if (!confirmEl) return;
      confirmEl.classList.add('show');
      setTimeout(() => {
        confirmEl.classList.remove('show');
      }, 900);
    }

    // Rendering function
    function renderCatalog(list) {
      container.innerHTML = ""; 

      list.forEach(cd => {
        const div = document.createElement('div');
        div.className = 'cd card';
        div.dataset.id = cd.CatalogNumber;

        div.innerHTML = `
          <img src="${cd.Image}" alt="${cd.Title}" loading="lazy">
          <h3>${cd.Title}</h3>
          <p><strong>Series:</strong> ${cd.Series}</p>
          <p><strong>Catalog #:</strong> ${cd.CatalogNumber}</p>
          <p><strong>Label:</strong> ${cd.Label}</p>
          <p><strong>Year:</strong> ${cd.Year}</p>
          <p><strong>Runtime:</strong> ${cd.Runtime}</p> 
          <p><strong>Description:</strong> ${cd.Description}</p>
          <p><strong>Condition:</strong> ${cd.Condition}</p>
          <p><strong>Price:</strong> $${cd.Price.toFixed(2)}</p>

          <div class="add-confirmation">Added!</div>

          <div class="buttons">
            <div class="cart-row">
              <button class="add-to-cart" data-id="${cd.CatalogNumber}">
                Add to Cart
              </button>
              <button class="view-cart">
                View Cart
              </button>
            </div>

            <div class="buy-label">
              <span>For more info about this CD:<br>-> email DaveGUrgent@aol.com<br>-> FB</span>
            </div>

            <div class="buy-row">
              <a class="email" href="${cd.PurchaseEmail}">Email</a>
              <a class="fb" href="${cd.PurchaseMessenger}">Msg on Facebook</a>
              ${cd.PDFScan ? '<a class="pdf" href="' + cd.PDFScan + '" target="_blank" rel="noopener">Actual Scans (PDF)</a>' : ''}
           </div>
          </div>
        `;

        container.appendChild(div);

        // Add to Cart logic (same as before)
        const addBtn = div.querySelector(".add-to-cart");
        addBtn.addEventListener("click", () => {
          const cart = getCart();
          if (!cart.some(item => item.CatalogNumber === cd.CatalogNumber)) {
            cart.push({
              Title: cd.Title,
              CatalogNumber: cd.CatalogNumber,
              Price: cd.Price,
              Image: cd.Image,
              Series: cd.Series
            });
            setCart(cart);
          }
          showAddConfirmation(cd.CatalogNumber);
          updateAddToCartButtons();
          updateCartButton();
        });

        // View Cart logic
        const viewBtn = div.querySelector(".view-cart");
        viewBtn.addEventListener("click", () => {
          const cartBtn = document.getElementById("cart-button");
          if (cartBtn) cartBtn.click();
        });
      });

      updateAddToCartButtons();
      updateCartButton();
    }

    // Filter logic
    seriesFilter.addEventListener('change', () => {
      const selected = seriesFilter.value;
      renderCatalog(selected === "" ? cds : cds.filter(cd => cd.Series === selected));
    });

    renderCatalog(cds);
  })
  .catch(err => console.error('Error loading JSONL:', err));


// ===============================
// SMOOTH SCROLL FOR ANCHOR LINKS
// ===============================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener("click", function (e) {
    const target = document.querySelector(this.getAttribute("href"));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth" });
    }
  });
});
