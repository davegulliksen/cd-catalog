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
// CART TOTALS
// ===============================
function calculateSubtotal() {
  const cart = getCart();
  return cart.reduce((sum, cd) => sum + cd.Price, 0);
}

function calculateShipping() {
  const cart = getCart();
  const subtotal = calculateSubtotal();

  if (subtotal >= 50) return 0; // Free shipping
  if (cart.length === 0) return 0;

  return 5 + (cart.length - 1) * 1; // $5 first CD, $1 each additional
}

function calculateTotal() {
  return calculateSubtotal() + calculateShipping();
}

// ===============================
// RENDER CART MODAL
// ===============================
function renderCart() {
  const modal = document.getElementById("cart-modal");
  const content = document.getElementById("cart-content");

  if (!modal || !content) return;

  const cart = getCart();

  let html = `
    <div class="cart-header">
      <h2>Your Cart</h2>
      <button id="close-cart" class="close-btn">✕</button>
    </div>

    <button id="return-shopping" class="return-btn top-return">
      Return to Shopping
    </button>
    <p class="checkout-hint">Or check out below</p>
  `;

  if (cart.length === 0) {
    html += `<p class="empty-msg">Your cart is empty.</p>`;
  } else {
    html += `<div class="cart-items">`;

    cart.forEach((cd, index) => {
      html += `
        <div class="cart-item">
          <img src="${cd.Image}" class="cart-thumb">
          <div class="cart-info">
            <strong>${cd.Title}</strong><br>
            <span class="cart-cat">${cd.CatalogNumber}</span><br>
            <span class="cart-price">$${cd.Price.toFixed(2)}</span>
          </div>
          <button class="remove-item" data-index="${index}">Remove</button>
        </div>
      `;
    });

    html += `</div>`;

const subtotal = calculateSubtotal();
const shipping = calculateShipping();
const total = calculateTotal();

// Determine free‑shipping message
let freeMsg = "";
const threshold = 50;

if (subtotal < threshold) {
  const amountNeeded = (threshold - subtotal).toFixed(2);
  freeMsg = `🚚 <em>Just $${amountNeeded} more and shipping is free.</em>`;
} else {
  freeMsg = `🚚 <em>You qualify for <strong>FREE</strong> shipping! Thanks for your order.</em>`;
}

html += `
  <div class="cart-totals">
    <p>Subtotal: <strong>$${subtotal.toFixed(2)}</strong></p>

    <!-- Free shipping message -->
    <div class="free-shipping-box">${freeMsg}</div>

    <p>Shipping: <strong>$${shipping.toFixed(2)}</strong></p>
    <p class="total-line">Total: <strong>$${total.toFixed(2)}</strong></p>
  </div>

  <div id="paypal-button-container"></div>
`;
  }

  content.innerHTML = html;

  // Wire up remove buttons
  document.querySelectorAll(".remove-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const index = parseInt(btn.dataset.index, 10);
      const cart = getCart();
      cart.splice(index, 1);
      setCart(cart);
      renderCart(); // re-render modal after removal
    });
  });

  // Close button
  const closeBtn = document.getElementById("close-cart");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      modal.classList.add("hidden");
      // script.js will react via cart-updated event
    });
  }

  // Return to Shopping button
  const returnBtn = document.getElementById("return-shopping");
  if (returnBtn) {
    returnBtn.addEventListener("click", () => {
      modal.classList.add("hidden");
      // script.js will react via cart-updated event if needed
    });
  }

  // Render PayPal buttons after content is in place
  renderPayPalButtons();
}

// ===============================
// OPEN CART BUTTON
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  const cartBtn = document.getElementById("cart-button");
  if (cartBtn) {
    cartBtn.addEventListener("click", () => {
      const modal = document.getElementById("cart-modal");
      if (!modal) return;
      modal.classList.remove("hidden");
      renderCart();
    });
  }
});

// ===============================
// PAYPAL SMART BUTTONS
// ===============================
function renderPayPalButtons() {
  const container = document.getElementById("paypal-button-container");
  if (!container) return;

  container.innerHTML = ""; // Clear old buttons

  const cart = getCart();
  if (cart.length === 0) return; // No checkout for empty cart

  if (typeof paypal === "undefined") {
    console.error("PayPal SDK not loaded.");
    return;
  }

  paypal.Buttons({
    style: {
      layout: 'vertical',
      color: 'gold',
      shape: 'rect',
      label: 'paypal'
    },

    // CREATE ORDER WITH FULL LINE ITEMS
    createOrder: function(data, actions) {
      const cart = getCart();
      const subtotal = cart.reduce((sum, cd) => sum + cd.Price, 0);
      const shipping = calculateShipping();
      const total = subtotal + shipping;

      const items = cart.map(cd => ({
        name: `${cd.Title} (${cd.CatalogNumber})`,
        unit_amount: {
          currency_code: "USD",
          value: cd.Price.toFixed(2)
        },
        quantity: "1",
        sku: cd.CatalogNumber
      }));

      return actions.order.create({
        purchase_units: [{
          amount: {
            currency_code: "USD",
            value: total.toFixed(2),
            breakdown: {
              item_total: { value: subtotal.toFixed(2), currency_code: "USD" },
              shipping: { value: shipping.toFixed(2), currency_code: "USD" }
            }
          },
          items: items
        }]
      });
    },

    // CAPTURE ORDER + EXTRACT SALES INFORMATION
    onApprove: function(data, actions) {
      return actions.order.capture().then(function(details) {
        const buyerName = details.purchase_units[0].shipping.name.full_name;
        const buyerEmail = details.payer.email_address;
        const address = details.purchase_units[0].shipping.address;

        const purchasedItems = details.purchase_units[0].items;
        const purchasedCatalogNumbers = purchasedItems.map(i => i.sku);

        console.log("=== NEW PAYPAL ORDER RECEIVED ===");
        console.log("Buyer:", buyerName);
        console.log("Email:", buyerEmail);
        console.log("Shipping Address:", address);
        console.log("Purchased Items:", purchasedItems);
        console.log("Catalog Numbers to remove in foobar2000:", purchasedCatalogNumbers);
        console.log("=================================");

        alert("Payment completed by " + buyerName);

        // Clear cart
        setCart([]);
        renderCart();
      });
    },

    onError: function(err) {
      console.error("PayPal Checkout Error:", err);
      alert("There was an issue with PayPal Checkout.");
    }

  }).render("#paypal-button-container");
}


// ===============================
// SMOOTH SCROLL FOR ANCHOR LINKS
// ===============================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener("click", function (e) {
    const href = this.getAttribute("href");
    if (!href || !href.startsWith("#")) return;
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth" });
    }
  });
});
