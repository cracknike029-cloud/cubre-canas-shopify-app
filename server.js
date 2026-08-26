require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";
const DEFAULT_CURRENCY = process.env.SHOPIFY_CURRENCY || "PYG";

// Configure each package in .env.
// Example:
// PACKAGE_1_VARIANT_ID=gid://shopify/ProductVariant/123
// PACKAGE_1_LABEL=1 unidad
// PACKAGE_1_PRICE=50000
// PACKAGE_2_VARIANT_ID=gid://shopify/ProductVariant/456
// PACKAGE_2_LABEL=2 unidades
// PACKAGE_2_PRICE=90000
// PACKAGE_3_VARIANT_ID=gid://shopify/ProductVariant/789
// PACKAGE_3_LABEL=3 unidades
// PACKAGE_3_PRICE=120000

function packagesFromEnv() {
  return [1, 2, 3].map((n) => ({
    id: String(n),
    label: process.env[`PACKAGE_${n}_LABEL`] || `${n} unidad${n > 1 ? "es" : ""}`,
    price: Number(process.env[`PACKAGE_${n}_PRICE`] || 0),
    variantId: process.env[`PACKAGE_${n}_VARIANT_ID`] || ""
  }));
}

app.get("/api/config", (_req, res) => {
  const packages = packagesFromEnv().map(({ id, label, price }) => ({ id, label, price }));
  res.json({
    productName: process.env.PRODUCT_NAME || "Cubre Canas",
    currency: DEFAULT_CURRENCY,
    delivery: "Delivery gratis",
    payment: "Pago contra entrega",
    packages
  });
});

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function validateOrder(body) {
  const required = ["firstName", "lastName", "phone", "address", "city", "packageId", "color"];
  for (const field of required) {
    if (!clean(body[field])) return `Falta completar: ${field}`;
  }

  if (!["1", "2", "3"].includes(String(body.packageId))) {
    return "Cantidad no válida.";
  }

  if (!clean(body.color, 60)) return "Selecciona un color.";
  return null;
}

const ORDER_CREATE = `
mutation orderCreate($order: OrderCreateOrderInput!) {
  orderCreate(order: $order) {
    userErrors {
      field
      message
    }
    order {
      id
      name
      displayFinancialStatus
    }
  }
}
`;

app.post("/api/orders", async (req, res) => {
  try {
    if (!SHOP || !TOKEN) {
      return res.status(500).json({
        ok: false,
        message: "La app todavía no está configurada con las credenciales de Shopify."
      });
    }

    const error = validateOrder(req.body);
    if (error) return res.status(400).json({ ok: false, message: error });

    const body = req.body;
    const packages = packagesFromEnv();
    const selected = packages.find((p) => p.id === String(body.packageId));

    if (!selected || !selected.variantId) {
      return res.status(500).json({
        ok: false,
        message: "Falta configurar la variante de Shopify para esta cantidad."
      });
    }

    const firstName = clean(body.firstName, 80);
    const lastName = clean(body.lastName, 80);
    const email = clean(body.email, 160);
    const phone = clean(body.phone, 40);
    const address = clean(body.address, 180);
    const city = clean(body.city, 80);
    const notes = clean(body.notes, 500);
    const color = clean(body.color, 60);
    const quantity = Number(body.packageId);

    const order = {
      lineItems: [{
        variantId: selected.variantId,
        quantity
      }],
      customer: {
        toUpsert: {
          firstName,
          lastName,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {})
        }
      },
      email: email || undefined,
      phone,
      financialStatus: "PENDING",
      shippingAddress: {
        firstName,
        lastName,
        address1: address,
        city,
        countryCode: "PY",
        phone
      },
      billingAddress: {
        firstName,
        lastName,
        address1: address,
        city,
        countryCode: "PY",
        phone
      },
      note: [
        "Pedido desde formulario Cubre Canas",
        `Color: ${color}`,
        `Cantidad/pack: ${selected.label}`,
        "Delivery: gratis",
        "Pago: contra entrega",
        notes ? `Nota: ${notes}` : ""
      ].filter(Boolean).join(" | ")
    };

    // Remove undefined properties.
    Object.keys(order).forEach((key) => {
      if (order[key] === undefined) delete order[key];
    });

    const response = await fetch(
      `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": TOKEN
        },
        body: JSON.stringify({
          query: ORDER_CREATE,
          variables: { order }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Shopify HTTP error:", data);
      return res.status(502).json({
        ok: false,
        message: "Shopify rechazó la solicitud."
      });
    }

    const payload = data?.data?.orderCreate;
    if (!payload) {
      console.error("Shopify response:", data);
      return res.status(502).json({
        ok: false,
        message: "No se recibió una respuesta válida de Shopify."
      });
    }

    if (payload.userErrors?.length) {
      console.error("Shopify userErrors:", payload.userErrors);
      return res.status(400).json({
        ok: false,
        message: payload.userErrors.map((e) => e.message).join(" ")
      });
    }

    return res.json({
      ok: true,
      order: {
        id: payload.order.id,
        name: payload.order.name
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      message: "No se pudo crear el pedido. Intenta nuevamente."
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Cubre Canas app running on port ${PORT}`);
});
