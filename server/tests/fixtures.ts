export const petstoreYaml = `
openapi: 3.0.3
info: { title: Petstore, version: "1.2.0" }
servers:
  - url: "https://{env}.petstore.example.com/v1"
    variables: { env: { default: api } }
security: [{ bearerAuth: [] }]
paths:
  /pets:
    get:
      tags: [pets]
      summary: List pets
      parameters:
        - { name: limit, in: query, schema: { type: integer } }
      responses:
        "200":
          description: ok
          content: { application/json: { schema: { type: array, items: { $ref: "#/components/schemas/Pet" } } } }
    post:
      tags: [pets]
      summary: Create a pet
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/NewPet" } } }
      responses:
        "201": { description: created, content: { application/json: { schema: { $ref: "#/components/schemas/Pet" } } } }
        "422": { description: invalid }
  /pets/{petId}:
    parameters:
      - { name: petId, in: path, required: true, schema: { type: integer, example: 42 } }
    get:
      tags: [pets]
      summary: Get a pet
      responses:
        "200": { description: ok, content: { application/json: { schema: { $ref: "#/components/schemas/Pet" } } } }
        "404": { description: missing }
  /health:
    get:
      security: []
      responses: { "200": { description: ok } }
components:
  securitySchemes: { bearerAuth: { type: http, scheme: bearer } }
  schemas:
    NewPet:
      type: object
      required: [name, species]
      properties:
        name: { type: string, maxLength: 50 }
        species: { type: string, enum: [dog, cat] }
        age: { type: integer, minimum: 0, maximum: 40 }
        notes: { type: string }
        owner: { $ref: "#/components/schemas/Owner" }
    Owner:
      type: object
      properties:
        email: { type: string, format: email }
        pets: { type: array, items: { $ref: "#/components/schemas/Owner" } }
    Pet:
      allOf:
        - { $ref: "#/components/schemas/NewPet" }
        - type: object
          required: [id]
          properties: { id: { type: integer, readOnly: true } }
`;

export const swagger2 = {
  swagger: "2.0",
  info: { title: "Legacy Users", version: "0.9" },
  host: "legacy.example.com",
  basePath: "/api",
  schemes: ["https"],
  paths: {
    "/users": {
      post: {
        parameters: [{ in: "body", name: "body", required: true, schema: { $ref: "#/definitions/User" } }],
        responses: { "200": { description: "ok", schema: { $ref: "#/definitions/User" } } },
      },
    },
  },
  definitions: { User: { type: "object", required: ["email"], properties: { email: { type: "string" }, age: { type: "integer" } } } },
};
