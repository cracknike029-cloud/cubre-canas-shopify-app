require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();


/* =====================================================
   EXPRESS
===================================================== */

app.use(
  express.json({
    limit:"100kb"
  })
);

app.use(
  express.urlencoded({
    extended:true
  })
);


const PORT =
  process.env.PORT ||
  3000;


const SHOP =
  process.env.SHOPIFY_SHOP;


const CLIENT_ID =
  process.env.SHOPIFY_CLIENT_ID;


const CLIENT_SECRET =
  process.env.SHOPIFY_CLIENT_SECRET;


const API_VERSION =
  process.env.SHOPIFY_API_VERSION ||
  "2026-07";


const CURRENCY =
  process.env.SHOPIFY_CURRENCY ||
  "PYG";


const PRODUCT_NAME =
  process.env.PRODUCT_NAME ||
  "Cubre Canas";


/* =====================================================
   PRECIOS
===================================================== */

const PACKAGES = [

  {
    id:"1",
    label:"1 unidad",
    price:169000
  },

  {
    id:"2",
    label:"2 unidades",
    price:321100
  },

  {
    id:"3",
    label:"3 unidades",
    price:456300
  }

];


/* =====================================================
   COLORES
===================================================== */

const COLORS = [

  "Negro",
  "Rojizo",
  "Café"

];


/* =====================================================
   TOKEN SHOPIFY
===================================================== */

let shopifyToken =
  null;


let shopifyTokenExpiresAt =
  0;


async function getShopifyAccessToken(){

  if(
    shopifyToken &&
    Date.now() <
      shopifyTokenExpiresAt
  ){

    return shopifyToken;

  }


  if(
    !SHOP ||
    !CLIENT_ID ||
    !CLIENT_SECRET
  ){

    throw new Error(
      "Faltan SHOPIFY_SHOP, SHOPIFY_CLIENT_ID o SHOPIFY_CLIENT_SECRET en Render."
    );

  }


  const response =
    await fetch(
      `https://${SHOP}/admin/oauth/access_token`,
      {

        method:"POST",

        headers:{
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          new URLSearchParams({

            grant_type:
              "client_credentials",

            client_id:
              CLIENT_ID,

            client_secret:
              CLIENT_SECRET

          })

      }
    );


  const text =
    await response.text();


  let data;


  try{

    data =
      JSON.parse(text);

  }catch{

    throw new Error(
      `Shopify devolvió una respuesta no JSON al autenticar: ${text.slice(0,300)}`
    );

  }


  if(
    !response.ok ||
    !data.access_token
  ){

    throw new Error(
      `Error de autenticación Shopify: ${JSON.stringify(data)}`
    );

  }


  shopifyToken =
    data.access_token;


  shopifyTokenExpiresAt =
    Date.now() +
    (
      (data.expires_in || 86399)
      - 300
    ) *
    1000;


  return shopifyToken;

}


/* =====================================================
   SHOPIFY GRAPHQL
===================================================== */

async function shopifyGraphQL(
  query,
  variables = {}
){

  const token =
    await getShopifyAccessToken();


  const response =
    await fetch(
      `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
      {

        method:"POST",

        headers:{

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


  const text =
    await response.text();


  let data;


  try{

    data =
      JSON.parse(text);

  }catch{

    throw new Error(
      `Shopify devolvió HTML o una respuesta no JSON: ${text.slice(0,300)}`
    );

  }


  if(!response.ok){

    throw new Error(
      `Shopify HTTP ${response.status}: ${JSON.stringify(data)}`
    );

  }


  if(data.errors?.length){

    throw new Error(
      data.errors
        .map(
          error =>
            error.message
        )
        .join(" | ")
    );

  }


  return data;

}


/* =====================================================
   CONFIG
===================================================== */

app.get(
  "/api/config",
  (_req,res) => {

    res.json({

      ok:true,

      productName:
        PRODUCT_NAME,

      currency:
        CURRENCY,

      delivery:
        "Delivery gratis",

      payment:
        "Pago contra entrega",

      packages:
        PACKAGES,

      colors:
        COLORS

    });

  }
);


/* =====================================================
   LIMPIAR DATOS
===================================================== */

function clean(
  value,
  max = 200
){

  return String(
    value ?? ""
  )
    .trim()
    .slice(0,max);

}


/* =====================================================
   NORMALIZAR COLOR
===================================================== */

function normalizeColor(
  value
){

  const normalized =
    clean(
      value,
      60
    ).toLowerCase();


  const found =
    COLORS.find(
      color =>
        color.toLowerCase() ===
        normalized
    );


  return found ||
    null;

}


/* =====================================================
   VALIDAR PEDIDO
===================================================== */

function validateOrder(
  body
){

  const required = [

    "firstName",
    "lastName",
    "phone",
    "address",
    "city",
    "packageId"

  ];


  for(
    const field of required
  ){

    if(
      !clean(
        body[field]
      )
    ){

      return (
        `Falta completar: ${field}`
      );

    }

  }


  const packageId =
    String(
      body.packageId
    );


  if(
    ![
      "1",
      "2",
      "3"
    ].includes(
      packageId
    )
  ){

    return (
      "Cantidad no válida."
    );

  }


  /* =================================================
     COLORES
  ================================================= */

  if(
    !Array.isArray(
      body.colors
    )
  ){

    return (
      "Selecciona los colores de todas las unidades."
    );

  }


  const quantity =
    Number(
      packageId
    );


  if(
    body.colors.length !==
    quantity
  ){

    return (
      `Debes seleccionar ${
        quantity
      } color${
        quantity > 1
          ? "es"
          : ""
      }.`
    );

  }


  for(
    let i = 0;
    i < body.colors.length;
    i++
  ){

    if(
      !normalizeColor(
        body.colors[i]
      )
    ){

      return (
        `Color no válido en la unidad ${
          i + 1
        }. Selecciona Negro, Rojizo o Café.`
      );

    }

  }


  return null;

}


/* =====================================================
   BUSCAR PRODUCTO Y VARIANTES
===================================================== */

const FIND_PRODUCTS = `

query FindProducts(
  $query:String!
){

  products(
    first:20,
    query:$query
  ){

    nodes{

      id

      title

      variants(
        first:100
      ){

        nodes{

          id

          title

          price

          selectedOptions{

            name

            value

          }

        }

      }

    }

  }

}

`;


async function findShopifyProductAndVariants(){

  const data =
    await shopifyGraphQL(
      FIND_PRODUCTS,
      {
        query:
          `title:${PRODUCT_NAME}`
      }
    );


  const products =
    data?.data?.products?.nodes ||
    [];


  if(
    !products.length
  ){

    throw new Error(
      `No encontré "${PRODUCT_NAME}" en Shopify.`
    );

  }


  const exact =
    products.find(
      product =>
        product.title
          .trim()
          .toLowerCase() ===
        PRODUCT_NAME
          .trim()
          .toLowerCase()
    );


  const product =
    exact ||
    products[0];


  const variants =
    product?.variants?.nodes ||
    [];


  if(
    !variants.length
  ){

    throw new Error(
      `El producto "${product.title}" no tiene variantes.`
    );

  }


  console.log(
    "================================="
  );

  console.log(
    "PRODUCTO SHOPIFY:",
    product.title
  );

  console.log(
    "VARIANTES SHOPIFY:"
  );


  variants.forEach(
    variant => {

      console.log(
        "Título:",
        variant.title
      );

      console.log(
        "Precio:",
        variant.price
      );

      console.log(
        "Variant ID:",
        variant.id
      );

      console.log(
        "Opciones:",
        JSON.stringify(
          variant.selectedOptions
        )
      );

      console.log(
        "---------------------------------"
      );

    }
  );


  return {
    product,
    variants
  };

}


/* =====================================================
   OBTENER COLOR DE VARIANTE
===================================================== */

function getColorFromVariant(
  variant
){

  const option =
    variant.selectedOptions?.find(
      option =>
        option.name
          ?.trim()
          .toLowerCase() ===
        "color"
    );


  return (
    option?.value
      ?.trim() ||
    null
  );

}


/* =====================================================
   BUSCAR VARIANTE POR COLOR
===================================================== */

function findVariantByColor(
  variants,
  color
){

  const wanted =
    color.toLowerCase();


  /* PRIMERO:
     buscar en selectedOptions */

  let variant =
    variants.find(
      item => {

        const variantColor =
          getColorFromVariant(
            item
          );


        return (
          variantColor &&
          variantColor
            .toLowerCase() ===
          wanted
        );

      }
    );


  if(variant){

    return variant;

  }


  /* SEGUNDO:
     buscar título exacto */

  variant =
    variants.find(
      item =>
        item.title
          ?.trim()
          .toLowerCase() ===
        wanted
    );


  if(variant){

    return variant;

  }


  /* TERCERO:
     buscar dentro del título */

  variant =
    variants.find(
      item =>
        item.title
          ?.toLowerCase()
          .includes(
            wanted
          )
    );


  return (
    variant ||
    null
  );

}


/* =====================================================
   CREAR PEDIDO
===================================================== */

const ORDER_CREATE = `

mutation CreateOrder(
  $order:OrderCreateOrderInput!
){

  orderCreate(
    order:$order
  ){

    userErrors{

      field

      message

    }

    order{

      id

      name

      displayFinancialStatus

      lineItems(
        first:20
      ){

        nodes{

          title

          quantity

          variant{

            id

            title

          }

        }

      }

    }

  }

}

`;


/* =====================================================
   API PEDIDOS
===================================================== */

app.post(
  "/api/orders",
  async (
    req,
    res
  ) => {

    try{

      console.log(
        "================================="
      );

      console.log(
        "NUEVO PEDIDO RECIBIDO"
      );


      console.log(
        JSON.stringify(
          req.body,
          null,
          2
        )
      );


      /* =================================================
         CREDENCIALES
      ================================================= */

      if(
        !SHOP ||
        !CLIENT_ID ||
        !CLIENT_SECRET
      ){

        return res
          .status(500)
          .json({

            ok:false,

            message:
              "Shopify todavía no está configurado correctamente en Render."

          });

      }


      /* =================================================
         VALIDACIÓN
      ================================================= */

      const validation =
        validateOrder(
          req.body
        );


      if(validation){

        return res
          .status(400)
          .json({

            ok:false,

            message:
              validation

          });

      }


      /* =================================================
         DATOS CLIENTE
      ================================================= */

      const firstName =
        clean(
          req.body.firstName,
          80
        );


      const lastName =
        clean(
          req.body.lastName,
          80
        );


      const email =
        clean(
          req.body.email,
          160
        );


      const phone =
        clean(
          req.body.phone,
          40
        );


      const address =
        clean(
          req.body.address,
          180
        );


      const city =
        clean(
          req.body.city,
          80
        );


      const notes =
        clean(
          req.body.notes,
          500
        );


      /* =================================================
         PAQUETE
      ================================================= */

      const packageId =
        String(
          req.body.packageId
        );


      const packageData =
        PACKAGES.find(
          packageItem =>
            packageItem.id ===
            packageId
        );


      if(!packageData){

        return res
          .status(400)
          .json({

            ok:false,

            message:
              "El paquete seleccionado no existe."

          });

      }


      /* =================================================
         COLORES
      ================================================= */

      const colors =
        req.body.colors.map(
          normalizeColor
        );


      const quantity =
        colors.length;


      console.log(
        "COLORES SELECCIONADOS:",
        colors
      );


      /* =================================================
         BUSCAR VARIANTES SHOPIFY
      ================================================= */

      const {
        variants
      } =
        await findShopifyProductAndVariants();


      /* =================================================
         ENCONTRAR VARIANTE PARA CADA COLOR
      ================================================= */

      const selectedVariants =
        colors.map(
          (
            color,
            index
          ) => {

            const variant =
              findVariantByColor(
                variants,
                color
              );


            if(!variant){

              throw new Error(
                `No encontré la variante de Shopify para el color "${color}" (unidad ${index + 1}).`
              );

            }


            return {

              color,

              variant

            };

          }
        );


      /* =================================================
         MOSTRAR VARIANT ID
      ================================================= */

      selectedVariants.forEach(
        (
          item,
          index
        ) => {

          console.log(
            `Unidad ${index + 1}:`
          );

          console.log(
            "Color:",
            item.color
          );

          console.log(
            "Variant ID:",
            item.variant.id
          );

          console.log(
            "Variant:",
            item.variant.title
          );

        }
      );


      /* =================================================
         PRECIO
      ================================================= */

      /*
        Precio total:

        1 unidad
        169.000 Gs

        2 unidades
        321.100 Gs

        3 unidades
        456.300 Gs
      */


      const unitPrice =
        packageData.price /
        quantity;


      /* =================================================
         LINE ITEMS
      ================================================= */

      const lineItems =
        selectedVariants.map(
          item => ({

            variantId:
              item.variant.id,

            quantity:1,

            priceSet:{

              shopMoney:{

                amount:
                  String(
                    unitPrice
                  ),

                currencyCode:
                  CURRENCY

              }

            },

            properties:[

              {
                name:
                  "Color seleccionado",

                value:
                  item.color
              },

              {
                name:
                  "Paquete",

                value:
                  packageData.label
              }

            ]

          })
        );


      /* =================================================
         RESUMEN COLORES
      ================================================= */

      const colorSummary =
        colors
          .map(
            (
              color,
              index
            ) =>
              `Unidad ${index + 1}: ${color}`
          )
          .join(
            " | "
          );


      /* =================================================
         PEDIDO
      ================================================= */

      const order = {

        lineItems,


        customer:{

          toUpsert:{

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
          email ||
          undefined,


        phone,


        financialStatus:
          "PENDING",


        shippingAddress:{

          firstName,

          lastName,

          address1:
            address,

          city,

          countryCode:
            "PY",

          phone

        },


        billingAddress:{

          firstName,

          lastName,

          address1:
            address,

          city,

          countryCode:
            "PY",

          phone

        },


        note:[

          "Pedido desde formulario Cubre Canas",

          `Cantidad: ${packageData.label}`,

          `Total del paquete: ${packageData.price} Gs`,

          colorSummary,

          "Delivery: gratis",

          "Pago: contra entrega",

          notes
            ? `Observaciones: ${notes}`
            : ""

        ]
          .filter(Boolean)
          .join(
            " | "
          )

      };


      /* =================================================
         LOG
      ================================================= */

      console.log(
        "Cantidad:",
        packageData.label
      );


      console.log(
        "Precio total:",
        packageData.price
      );


      console.log(
        "Precio por unidad:",
        unitPrice
      );


      console.log(
        "Line items:"
      );


      console.log(
        JSON.stringify(
          lineItems,
          null,
          2
        )
      );


      /* =================================================
         CREAR EN SHOPIFY
      ================================================= */

      const data =
        await shopifyGraphQL(
          ORDER_CREATE,
          {
            order
          }
        );


      const result =
        data?.data?.orderCreate;


      if(!result){

        return res
          .status(502)
          .json({

            ok:false,

            message:
              "Shopify no devolvió información del pedido."

          });

      }


      /* =================================================
         ERRORES SHOPIFY
      ================================================= */

      if(
        result.userErrors &&
        result.userErrors.length
      ){

        const message =
          result.userErrors
            .map(
              error =>
                error.message
            )
            .join(
              " | "
            );


        console.error(
          "SHOPIFY RECHAZÓ:",
          message
        );


        return res
          .status(400)
          .json({

            ok:false,

            message

          });

      }


      /* =================================================
         VERIFICAR PEDIDO
      ================================================= */

      if(
        !result.order
      ){

        return res
          .status(502)
          .json({

            ok:false,

            message:
              "Shopify no creó el pedido."

          });

      }


      /* =================================================
         ÉXITO
      ================================================= */

      console.log(
        "================================="
      );


      console.log(
        "PEDIDO CREADO:",
        result.order.name
      );


      console.log(
        "================================="
      );


      return res
        .status(200)
        .json({

          ok:true,

          message:
            "Pedido creado correctamente.",

          order:{

            id:
              result.order.id,

            name:
              result.order.name

          }

        });


    }catch(error){

      console.error(
        "ERROR AL CREAR PEDIDO:",
        error
      );


      return res
        .status(500)
        .json({

          ok:false,

          message:
            error?.message ||
            "Ocurrió un error al crear el pedido."

        });

    }

  }
);


/* =====================================================
   ERRORES API
===================================================== */

app.use(
  "/api",
  (
    req,
    res
  ) => {

    res
      .status(404)
      .json({

        ok:false,

        message:
          "Ruta API no encontrada."

      });

  }
);


/* =====================================================
   ARCHIVOS
===================================================== */

app.use(
  express.static(
    __dirname
  )
);


/* =====================================================
   FALLBACK HTML
===================================================== */

app.use(
  (
    _req,
    res
  ) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);


/* =====================================================
   SERVIDOR
===================================================== */

app.listen(
  PORT,
  () => {

    console.log(
      "================================="
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


    PACKAGES.forEach(
      item => {

        console.log(
          `${item.label}: ${item.price} Gs`
        );

      }
    );


    console.log(
      "Colores:",
      COLORS.join(", ")
    );


    console.log(
      "================================="
    );

  }
);
