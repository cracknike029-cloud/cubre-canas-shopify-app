require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const SHOP = String(process.env.SHOPIFY_SHOP || "")
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "")
  .replace(/\.myshopify\.com$/i, "");

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const API_VERSION =
  process.env.SHOPIFY_API_VERSION || "2026-07";

const CURRENCY =
  process.env.SHOPIFY_CURRENCY || "PYG";


/* =====================================================
   CUBRE CANAS
   PRECIOS DEFINITIVOS
===================================================== */

const PACKS = {
  1: {
    id: "1",
    label: "1 unidad",
    quantity: 1,
    price: 169000,
    oldPrice: 169000,
    discount: 0
  },

  2: {
    id: "2",
    label: "2 unidades",
    quantity: 2,
    price: 321100,
    oldPrice: 338000,
    discount: 16900
  },

  3: {
    id: "3",
    label: "3 unidades",
    quantity: 3,
    price: 456300,
    oldPrice: 507000,
    discount: 50700
  }
};


/* =====================================================
   VARIANTES SHOPIFY
   NEGRO / ROJIZO / CAFÉ
===================================================== */

const COLOR_VARIANTS = {
  "Negro":
    "gid://shopify/ProductVariant/55924530151729",

  "Rojizo":
    "gid://shopify/ProductVariant/55924530184497",

  "Café":
    "gid://shopify/ProductVariant/55924530217265"
};


/* =====================================================
   TOKEN SHOPIFY
===================================================== */

let shopifyToken = null;
let shopifyTokenExpiresAt = 0;


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
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
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

    console.error(
      "SHOPIFY AUTH ERROR:",
      data
    );

    throw new Error(
      "Shopify no pudo generar el token de acceso."
    );
  }


  shopifyToken =
    data.access_token;


  const expiresIn =
    Number(data.expires_in) || 86399;


  shopifyTokenExpiresAt =
    Date.now() +
    Math.max(
      expiresIn - 300,
      60
    ) * 1000;


  console.log(
    "Token Shopify obtenido correctamente."
  );


  return shopifyToken;
}


/* =====================================================
   GRAPHQL SHOPIFY
===================================================== */

async function shopifyGraphQL(
  query,
  variables = {}
) {

  const token =
    await getShopifyAccessToken();


  const response =
    await fetch(
      `https://${SHOP}.myshopify.com/admin/api/${API_VERSION}/graphql.json`,
      {

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "X-Shopify-Access-Token":
            token
        },

        body: JSON.stringify({
          query,
          variables
        })
      }
    );


  const data =
    await response.json();


  if (!response.ok) {

    console.error(
      "SHOPIFY HTTP ERROR:",
      data
    );

    throw new Error(
      "Shopify rechazó la solicitud."
    );
  }


  if (data.errors?.length) {

    console.error(
      "SHOPIFY GRAPHQL ERROR:",
      data.errors
    );

    throw new Error(
      data.errors
        .map(
          error => error.message
        )
        .join(" ")
    );
  }


  return data.data;
}


/* =====================================================
   CONFIGURACIÓN PARA EL FRONTEND
===================================================== */

app.get(
  "/api/config",
  (_req, res) => {

    res.json({

      productName:
        process.env.PRODUCT_NAME ||
        "CUBRE CANAS",

      currency:
        CURRENCY,

      delivery:
        "Delivery gratis",

      payment:
        "Pago contra entrega",

      colors: [

        {
          id: "Negro",
          label: "Negro"
        },

        {
          id: "Rojizo",
          label: "Rojizo"
        },

        {
          id: "Café",
          label: "Café"
        }

      ],

      packages: [

        PACKS[1],
        PACKS[2],
        PACKS[3]

      ]

    });

  }
);


/* =====================================================
   LIMPIAR DATOS
===================================================== */

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


/* =====================================================
   NORMALIZAR COLOR
===================================================== */

function normalizeColor(
  value
) {

  const color =
    clean(
      value,
      60
    )
      .toLowerCase()
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      );


  if (
    color === "negro"
  ) {
    return "Negro";
  }


  if (
    color === "rojizo"
  ) {
    return "Rojizo";
  }


  if (
    color === "cafe"
  ) {
    return "Café";
  }


  return null;
}


/* =====================================================
   VALIDAR PEDIDO
===================================================== */

function validateOrder(
  body
) {

  const required = [

    "firstName",
    "lastName",
    "phone",
    "address",
    "city",
    "packageId",
    "colors"

  ];


  for (
    const field of required
  ) {

    if (
      !body[field]
    ) {

      return (
        `Falta completar: ${field}`
      );

    }

  }


  const packageId =
    String(
      body.packageId
    );


  if (
    !PACKS[packageId]
  ) {

    return (
      "Cantidad no válida."
    );

  }


  if (
    !Array.isArray(
      body.colors
    )
  ) {

    return (
      "Los colores seleccionados no son válidos."
    );

  }


  const expectedQuantity =
    PACKS[packageId].quantity;


  if (
    body.colors.length !==
    expectedQuantity
  ) {

    return (
      "Selecciona un color para cada unidad."
    );

  }


  for (
    const color of body.colors
  ) {

    if (
      !normalizeColor(color)
    ) {

      return (
        "Uno de los colores seleccionados no es válido."
      );

    }

  }


  return null;
}


/* =====================================================
   MUTATION ORDER CREATE
===================================================== */

const ORDER_CREATE = `

mutation orderCreate(
  $order: OrderCreateOrderInput!
) {

  orderCreate(
    order: $order
  ) {

    userErrors {

      field

      message

    }

    order {

      id

      name

      displayFinancialStatus

      currentTotalPriceSet {

        shopMoney {

          amount

          currencyCode

        }

      }

    }

  }

}
`;


/* =====================================================
   CREAR PEDIDO
===================================================== */

app.post(
  "/api/orders",
  async (req, res) => {

    try {

      /* =============================================
         VALIDAR
      ============================================= */

      const validationError =
        validateOrder(
          req.body
        );


      if (
        validationError
      ) {

        return res
          .status(400)
          .json({

            ok: false,

            message:
              validationError

          });

      }


      /* =============================================
         DATOS
      ============================================= */

      const body =
        req.body;


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


      const house =
        clean(
          body.house,
          40
        );


      const city =
        clean(
          body.city,
          80
        );


      const email =
        clean(
          body.email,
          160
        );


      const notes =
        clean(
          body.notes,
          500
        );


      const packageId =
        String(
          body.packageId
        );


      const pack =
        PACKS[packageId];


      /* =============================================
         COLORES
      ============================================= */

      const colors =
        body.colors.map(
          color =>
            normalizeColor(
              color
            )
        );


      /* =============================================
         CREAR LINE ITEMS
         
         Cada unidad puede tener un color diferente.
      ============================================= */

      const lineItems = [];


      colors.forEach(
        (
          color,
          index
        ) => {

          const variantId =
            COLOR_VARIANTS[color];


          if (
            !variantId
          ) {

            throw new Error(
              `No existe variante para el color ${color}.`
            );

          }


          lineItems.push({

            variantId,

            quantity: 1,

            customAttributes: [

              {
                key:
                  "Color",

                value:
                  color
              },

              {
                key:
                  "Unidad",

                value:
                  String(
                    index + 1
                  )
              },

              {
                key:
                  "Pack",

                value:
                  pack.label
              }

            ]

          });

        }
      );


      /* =============================================
         DIRECCIÓN
      ============================================= */

      const fullAddress =
        house
          ? `${address} - Casa ${house}`
          : address;


      /* =============================================
         PEDIDO
      ============================================= */

      const order = {

        lineItems,

        customer: {

          toUpsert: {

            firstName,

            lastName,

            ...(email
              ? {
                  email
                }
              : {}),

            phone

          }

        },


        ...(email
          ? {
              email
            }
          : {}),


        phone,


        financialStatus:
          "PENDING",


        shippingAddress: {

          firstName,

          lastName,

          address1:
            fullAddress,

          city,

          countryCode:
            "PY",

          phone

        },


        billingAddress: {

          firstName,

          lastName,

          address1:
            fullAddress,

          city,

          countryCode:
            "PY",

          phone

        },


        note: [

          "PEDIDO DESDE FORMULARIO CUBRE CANAS",

          `Pack: ${pack.label}`,

          `Cantidad: ${pack.quantity}`,

          `Colores: ${colors.join(" / ")}`,

          `Subtotal: Gs. ${pack.oldPrice.toLocaleString("es-PY")}`,

          `Descuento: Gs. ${pack.discount.toLocaleString("es-PY")}`,

          `Total: Gs. ${pack.price.toLocaleString("es-PY")}`,

          "Delivery: GRATIS",

          "Pago: CONTRA ENTREGA",

          notes
            ? `Nota: ${notes}`
            : ""

        ]
          .filter(Boolean)
          .join(" | ")

      };


      /* =============================================
         CREAR PEDIDO EN SHOPIFY
      ============================================= */

      const data =
        await shopifyGraphQL(
          ORDER_CREATE,
          {
            order
          }
        );


      const result =
        data?.orderCreate;


      if (
        !result
      ) {

        return res
          .status(502)
          .json({

            ok: false,

            message:
              "Shopify no devolvió el resultado del pedido."

          });

      }


      /* =============================================
         ERRORES SHOPIFY
      ============================================= */

      if (
        result.userErrors &&
        result.userErrors.length
      ) {

        console.error(
          "SHOPIFY USER ERRORS:",
          result.userErrors
        );


        return res
          .status(400)
          .json({

            ok: false,

            message:
              result.userErrors
                .map(
                  error =>
                    error.message
                )
                .join(" ")

          });

      }


      /* =============================================
         ÉXITO
      ============================================= */

      console.log(
        "PEDIDO CREADO:",
        result.order.name
      );


      return res.json({

        ok: true,

        order: {

          id:
            result.order.id,

          name:
            result.order.name,

          total:
            result.order
              .currentTotalPriceSet
              ?.shopMoney
              ?.amount,

          currency:
            result.order
              .currentTotalPriceSet
              ?.shopMoney
              ?.currencyCode

        }

      });


    } catch (
      error
    ) {

      console.error(
        "ERROR CREANDO PEDIDO:",
        error
      );


      return res
        .status(500)
        .json({

          ok: false,

          message:
            error?.message ||
            "No se pudo crear el pedido."

        });

    }

  }
);


/* =====================================================
   SERVIR ARCHIVOS
===================================================== */

app.use(
  express.static(
    __dirname
  )
);


/* =====================================================
   INDEX.HTML
===================================================== */

app.get(
  /.*/,
  (_req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);


/* =====================================================
   INICIAR SERVIDOR
===================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      `Cubre Canas app running on port ${PORT}`
    );

  }
);
