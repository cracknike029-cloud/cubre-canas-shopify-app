require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const API_VERSION =
  process.env.SHOPIFY_API_VERSION || "2026-07";

const DEFAULT_CURRENCY =
  process.env.SHOPIFY_CURRENCY || "PYG";

const PRODUCT_NAME =
  process.env.PRODUCT_NAME || "Cubre Canas";

let shopifyToken = null;
let shopifyTokenExpiresAt = 0;

/* =========================================================
   PAQUETES
========================================================= */

const DEFAULT_PACKAGES = [
  {
    id: "1",
    label: "1 unidad",
    price: 169000
  },
  {
    id: "2",
    label: "2 unidades",
    price: 321100
  },
  {
    id: "3",
    label: "3 unidades",
    price: 456300
  }
];

function packagesFromEnv() {
  return DEFAULT_PACKAGES.map((pack) => {
    const n = pack.id;

    const envPrice =
      process.env[`PACKAGE_${n}_PRICE`];

    const envLabel =
      process.env[`PACKAGE_${n}_LABEL`];

    const variantId =
      process.env[`PACKAGE_${n}_VARIANT_ID`] || "";

    const parsedPrice =
      Number(envPrice);

    return {
      id: pack.id,

      label:
        envLabel || pack.label,

      price:
        envPrice &&
        !Number.isNaN(parsedPrice)
          ? parsedPrice
          : pack.price,

      variantId
    };
  });
}

/* =========================================================
   TOKEN SHOPIFY
========================================================= */

async function getShopifyAccessToken() {
  if (
    shopifyToken &&
    Date.now() < shopifyTokenExpiresAt
  ) {
    return shopifyToken;
  }

  if (
    !SHOP ||
    !CLIENT_ID ||
    !CLIENT_SECRET
  ) {
    throw new Error(
      "Faltan las credenciales de Shopify."
    );
  }

  const response = await fetch(
    `https://${SHOP}/admin/oauth/access_token`,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded"
      },

      body: new URLSearchParams({
        grant_type:
          "client_credentials",

        client_id:
          CLIENT_ID,

        client_secret:
          CLIENT_SECRET
      })
    }
  );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      `Shopify authentication error: ${JSON.stringify(data)}`
    );
  }

  shopifyToken =
    data.access_token;

  shopifyTokenExpiresAt =
    Date.now() +
    ((data.expires_in || 86399) - 300) *
      1000;

  return shopifyToken;
}

/* =========================================================
   GRAPHQL SHOPIFY
========================================================= */

async function shopifyGraphQL(
  query,
  variables = {}
) {
  const token =
    await getShopifyAccessToken();

  const response =
    await fetch(
      `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "X-Shopify-Access-Token":
            token
        },

        body:
          JSON.stringify({
            query,
            variables
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      `Shopify HTTP error: ${JSON.stringify(data)}`
    );
  }

  if (data.errors) {
    throw new Error(
      `Shopify GraphQL error: ${JSON.stringify(data.errors)}`
    );
  }

  return data;
}

/* =========================================================
   BUSCAR PRODUCTO Y VARIANTES AUTOMÁTICAMENTE
========================================================= */

const FIND_PRODUCT = `
query FindProduct($query: String!) {
  products(first: 20, query: $query) {
    nodes {
      id
      title

      variants(first: 100) {
        nodes {
          id
          title
          price
          sku
          selectedOptions {
            name
            value
          }
        }
      }
    }
  }
}
`;

async function findCubreCanasVariants() {
  const searchQuery =
    `title:${PRODUCT_NAME}`;

  const data =
    await shopifyGraphQL(
      FIND_PRODUCT,
      {
        query:
          searchQuery
      }
    );

  const products =
    data?.data?.products?.nodes ||
    [];

  if (!products.length) {
    throw new Error(
      `No encontré el producto "${PRODUCT_NAME}" en Shopify.`
    );
  }

  /*
    Buscamos primero coincidencia exacta.
  */

  let product =
    products.find(
      (p) =>
        p.title
          .trim()
          .toLowerCase() ===
        PRODUCT_NAME
          .trim()
          .toLowerCase()
    );

  /*
    Si no existe coincidencia exacta,
    usamos la primera coincidencia.
  */

  if (!product) {
    product =
      products[0];
  }

  const variants =
    product.variants?.nodes ||
    [];

  if (!variants.length) {
    throw new Error(
      `El producto "${product.title}" no tiene variantes disponibles.`
    );
  }

  console.log(
    "======================================"
  );

  console.log(
    `Producto Shopify encontrado: ${product.title}`
  );

  console.log(
    "Variantes encontradas:"
  );

  variants.forEach(
    (variant) => {
      console.log(
        `- ${variant.title} | ${variant.price} | ${variant.id}`
      );
    }
  );

  console.log(
    "======================================"
  );

  return variants;
}

/* =========================================================
   NORMALIZAR TEXTO
========================================================= */

function normalizeText(value) {
  return String(
    value || ""
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

/* =========================================================
   BUSCAR VARIANTE PARA EL PACK
========================================================= */

function findVariantForPackage(
  variants,
  selectedPackage
) {
  const wantedNumber =
    Number(
      selectedPackage.id
    );

  /*
    1. Buscar por título:
       "1 unidad"
       "2 unidades"
       "3 unidades"
  */

  const byTitle =
    variants.find(
      (variant) => {
        const title =
          normalizeText(
            variant.title
          );

        const hasNumber =
          title.includes(
            String(
              wantedNumber
            )
          );

        const hasUnitWord =
          title.includes(
            "unidad"
          );

        return (
          hasNumber &&
          hasUnitWord
        );
      }
    );

  if (byTitle) {
    return {
      variant: byTitle,
      exact: true
    };
  }

  /*
    2. Buscar por precio.
  */

  const byPrice =
    variants.find(
      (variant) =>
        Number(
          variant.price
        ) ===
        Number(
          selectedPackage.price
        )
    );

  if (byPrice) {
    return {
      variant: byPrice,
      exact: true
    };
  }

  /*
    3. Si Shopify tiene una sola variante,
       podemos utilizarla como base.
  */

  if (
    variants.length === 1
  ) {
    return {
      variant: variants[0],
      exact: false
    };
  }

  return null;
}

/* =========================================================
   CONFIG DEL FORMULARIO
========================================================= */

app.get(
  "/api/config",
  (_req, res) => {
    const packages =
      packagesFromEnv().map(
        ({
          id,
          label,
          price
        }) => ({
          id,
          label,
          price
        })
      );

    res.json({
      productName:
        PRODUCT_NAME,

      currency:
        DEFAULT_CURRENCY,

      delivery:
        "Delivery gratis",

      payment:
        "Pago contra entrega",

      packages
    });
  }
);

/* =========================================================
   LIMPIAR DATOS
========================================================= */

function clean(
  value,
  max = 200
) {
  return String(
    value ?? ""
  )
    .trim()
    .slice(0, max);
}

/* =========================================================
   COLORES VÁLIDOS
========================================================= */

const VALID_COLORS = [
  "Negro",
  "Rojizo",
  "Café"
];

/* =========================================================
   VALIDAR PEDIDO
========================================================= */

function validateOrder(body) {
  const required = [
    "firstName",
    "lastName",
    "phone",
    "address",
    "city",
    "packageId"
  ];

  for (
    const field of required
  ) {
    if (
      !clean(body[field])
    ) {
      return `Falta completar: ${field}`;
    }
  }

  if (
    !["1", "2", "3"].includes(
      String(
        body.packageId
      )
    )
  ) {
    return "Cantidad no válida.";
  }

  /*
    Aceptamos "color" y también
    "colors" por compatibilidad.
  */

  const color =
    clean(
      body.color,
      60
    ) ||
    clean(
      body.colors,
      60
    );

  if (!color) {
    return "Selecciona un color.";
  }

  if (
    !VALID_COLORS.includes(
      color
    )
  ) {
    return (
      "Color no válido. " +
      "Selecciona Negro, Rojizo o Café."
    );
  }

  return null;
}

/* =========================================================
   ORDER CREATE
========================================================= */

const ORDER_CREATE = `
mutation orderCreate(
  $order: OrderCreateOrderInput!
) {
  orderCreate(order: $order) {

    userErrors {
      field
      message
    }

    order {
      id
      name
      displayFinancialStatus

      lineItems(first: 10) {
        nodes {
          title
          quantity

          variant {
            id
          }
        }
      }
    }
  }
}
`;

/* =========================================================
   CREAR PEDIDO
========================================================= */

app.post(
  "/api/orders",
  async (req, res) => {
    try {
      /* -------------------------------------
         CREDENCIALES
      ------------------------------------- */

      if (
        !SHOP ||
        !CLIENT_ID ||
        !CLIENT_SECRET
      ) {
        return res.status(500).json({
          ok: false,

          message:
            "La aplicación no está configurada con las credenciales de Shopify."
        });
      }

      /* -------------------------------------
         VALIDAR FORMULARIO
      ------------------------------------- */

      const validationError =
        validateOrder(
          req.body
        );

      if (
        validationError
      ) {
        return res.status(400).json({
          ok: false,

          message:
            validationError
        });
      }

      const body =
        req.body;

      /* -------------------------------------
         PAQUETE
      ------------------------------------- */

      const packages =
        packagesFromEnv();

      const selected =
        packages.find(
          (p) =>
            p.id ===
            String(
              body.packageId
            )
        );

      if (!selected) {
        return res.status(400).json({
          ok: false,

          message:
            "El paquete seleccionado no existe."
        });
      }

      /* -------------------------------------
         DATOS CLIENTE
      ------------------------------------- */

      const firstName =
        clean(
          body.firstName,
          80
        );

      const lastName =
        clean(
          body.lastName,
          80
        );

      const email =
        clean(
          body.email,
          160
        );

      const phone =
        clean(
          body.phone,
          40
        );

      const address =
        clean(
          body.address,
          180
        );

      const city =
        clean(
          body.city,
          80
        );

      const notes =
        clean(
          body.notes,
          500
        );

      const color =
        clean(
          body.color,
          60
        ) ||
        clean(
          body.colors,
          60
        );

      /* -------------------------------------
         OBTENER VARIANTES DE SHOPIFY
      ------------------------------------- */

      const variants =
        await findCubreCanasVariants();

      /* -------------------------------------
         BUSCAR VARIANTE
      ------------------------------------- */

      let variantResult =
        findVariantForPackage(
          variants,
          selected
        );

      /*
        Si existe una variable
        PACKAGE_X_VARIANT_ID,
        tiene prioridad.
      */

      const configuredVariantId =
        selected.variantId;

      let variantId = null;

      let usingPriceOverride =
        false;

      if (
        configuredVariantId
      ) {
        variantId =
          configuredVariantId;
      } else if (
        variantResult
      ) {
        variantId =
          variantResult.variant.id;

        /*
          Si no coincidió exactamente
          con la variante, usamos el precio
          seleccionado del formulario.
        */

        if (
          !variantResult.exact
        ) {
          usingPriceOverride =
            true;
        }
      }

      if (!variantId) {
        return res.status(500).json({
          ok: false,

          message:
            `No pude encontrar automáticamente una variante de Shopify para "${selected.label}".`
        });
      }

      /* -------------------------------------
         LINE ITEM
      ------------------------------------- */

      const lineItem = {
        variantId,

        /*
          IMPORTANTE:
          Cada botón representa un PACK.

          Por eso siempre quantity = 1.

          1 unidad -> 1 pack
          2 unidades -> 1 pack
          3 unidades -> 1 pack
        */

        quantity: 1
      };

      /*
        Si usamos una variante base porque
        Shopify no tiene variantes separadas
        para los packs, ponemos el precio
        correcto directamente en el pedido.

        Shopify permite priceSet en lineItems
        de orderCreate.
      */

      if (
        usingPriceOverride
      ) {
        lineItem.priceSet = {
          shopMoney: {
            amount:
              String(
                selected.price
              ),

            currencyCode:
              DEFAULT_CURRENCY
          }
        };
      }

      /* -------------------------------------
         CREAR OBJETO ORDER
      ------------------------------------- */

      const order = {
        lineItems: [
          lineItem
        ],

        customer: {
          toUpsert: {
            firstName,
            lastName,

            ...(email
              ? {
                  email
                }
              : {}),

            ...(phone
              ? {
                  phone
                }
              : {})
          }
        },

        email:
          email || undefined,

        phone,

        financialStatus:
          "PENDING",

        shippingAddress: {
          firstName,
          lastName,

          address1:
            address,

          city,

          countryCode:
            "PY",

          phone
        },

        billingAddress: {
          firstName,
          lastName,

          address1:
            address,

          city,

          countryCode:
            "PY",

          phone
        },

        note: [
          "Pedido desde formulario Cubre Canas",

          `Color: ${color}`,

          `Cantidad/pack: ${selected.label}`,

          `Precio seleccionado: ${selected.price} Gs`,

          "Delivery: gratis",

          "Pago: contra entrega",

          notes
            ? `Nota: ${notes}`
            : ""
        ]
          .filter(Boolean)
          .join(
            " | "
          )
      };

      /*
        Eliminar undefined
      */

      Object.keys(order)
        .forEach(
          (key) => {
            if (
              order[key] ===
              undefined
            ) {
              delete order[key];
            }
          }
        );

      /* -------------------------------------
         LOG
      ------------------------------------- */

      console.log(
        "======================================"
      );

      console.log(
        "CREANDO PEDIDO"
      );

      console.log(
        `Cliente: ${firstName} ${lastName}`
      );

      console.log(
        `Pack: ${selected.label}`
      );

      console.log(
        `Precio: ${selected.price} Gs`
      );

      console.log(
        `Color: ${color}`
      );

      console.log(
        `Variant ID: ${variantId}`
      );

      console.log(
        `Price override: ${usingPriceOverride}`
      );

      console.log(
        "======================================"
      );

      /* -------------------------------------
         ENVIAR A SHOPIFY
      ------------------------------------- */

      const data =
        await shopifyGraphQL(
          ORDER_CREATE,
          {
            order
          }
        );

      const payload =
        data?.data
          ?.orderCreate;

      if (!payload) {
        console.error(
          "Respuesta Shopify:",
          data
        );

        return res.status(502).json({
          ok: false,

          message:
            "Shopify no devolvió una respuesta válida."
        });
      }

      /* -------------------------------------
         USER ERRORS
      ------------------------------------- */

      if (
        payload.userErrors &&
        payload.userErrors.length
      ) {
        console.error(
          "Shopify userErrors:",
          payload.userErrors
        );

        return res.status(400).json({
          ok: false,

          message:
            payload.userErrors
              .map(
                (e) =>
                  e.message
              )
              .join(
                " "
              )
        });
      }

      /* -------------------------------------
         ÉXITO
      ------------------------------------- */

      if (
        !payload.order
      ) {
        return res.status(502).json({
          ok: false,

          message:
            "Shopify no devolvió el pedido creado."
        });
      }

      console.log(
        "======================================"
      );

      console.log(
        "PEDIDO CREADO CORRECTAMENTE"
      );

      console.log(
        `Número: ${payload.order.name}`
      );

      console.log(
        "======================================"
      );

      return res.json({
        ok: true,

        order: {
          id:
            payload.order.id,

          name:
            payload.order.name
        }
      });

    } catch (error) {
      console.error(
        "======================================"
      );

      console.error(
        "ERROR GENERAL:",
        error
      );

      console.error(
        "======================================"
      );

      return res.status(500).json({
        ok: false,

        message:
          error.message ||
          "No se pudo crear el pedido. Intenta nuevamente."
      });
    }
  }
);

/* =========================================================
   SERVIR INDEX.HTML
========================================================= */

app.use(
  express.static(
    __dirname
  )
);

app.use(
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);

/* =========================================================
   INICIAR SERVIDOR
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      "======================================"
    );

    console.log(
      `Cubre Canas app running on port ${PORT}`
    );

    console.log(
      `Producto: ${PRODUCT_NAME}`
    );

    console.log(
      "Precios:"
    );

    packagesFromEnv()
      .forEach(
        (p) => {
          console.log(
            `- ${p.label}: ${p.price} Gs`
          );
        }
      );

    console.log(
      "Colores: Negro, Rojizo, Café"
    );

    console.log(
      "======================================"
    );
  }
);
