/**
 * Product queries. Page sizes are chosen to keep each request's calculated
 * cost under the Admin API's single-query limit (1000 points):
 * 15 products x (1 + 10 media + 50 variants) ~ 915.
 */

export const PRODUCT_PAGE_SIZE = 15;

const LIST_PRODUCT_FIELDS = `#graphql
  fragment VmListProduct on Product {
    id
    legacyResourceId
    title
    handle
    productType
    vendor
    tags
    status
    description
    updatedAt
    category { fullName }
    media(first: 10) {
      nodes {
        __typename
        ... on MediaImage { image { url altText width height } }
        ... on Model3d { sources { url format } }
      }
    }
    variants(first: 50) {
      nodes { id legacyResourceId title selectedOptions { name value } }
    }
  }
`;

export const PRODUCTS_PAGE_QUERY = `#graphql
  ${LIST_PRODUCT_FIELDS}
  query VmProductsPage($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: ID) {
      nodes { ...VmListProduct }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Single product with variant images, for the detail page and preparation. */
export const PRODUCT_DETAIL_QUERY = `#graphql
  query VmProductDetail($id: ID!) {
    product(id: $id) {
      id
      legacyResourceId
      title
      handle
      productType
      vendor
      tags
      status
      description
      updatedAt
      onlineStorePreviewUrl
      category { fullName }
      media(first: 20) {
        nodes {
          __typename
          ... on MediaImage { image { url altText width height } }
          ... on Model3d { sources { url format } }
        }
      }
      variants(first: 100) {
        nodes {
          id
          legacyResourceId
          title
          selectedOptions { name value }
          media(first: 1) {
            nodes { __typename ... on MediaImage { image { url altText width height } } }
          }
        }
      }
    }
  }
`;
