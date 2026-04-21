# Asian Import Export Co Backend API Documentation

Last updated: April 2, 2026

## 1) Overview

This backend is an Express + MongoDB API that supports:
- Customer profile persistence for Firebase-authenticated customers
- Admin-protected dashboard APIs
- Database-only authorized-person management (admin/moderator)
- Customer inquiry email delivery
- Order invoice email delivery

Base URL examples:
- Local: https://asian-import-export-co-backend.vercel.app
- Production: your deployed backend domain

## 2) Tech Stack

- Node.js + Express
- MongoDB + Mongoose
- Nodemailer (SMTP)
- Firebase Admin SDK support (optional in current fallback mode)
- CORS with allowlist

## 3) Environment Variables

Core:
- PORT (optional, default 5000)
- MONGODB_URI (required)
- FRONTEND_URL (optional, CORS allowlist)

Email:
- SMTP_HOST
- SMTP_PORT
- SMTP_USER
- SMTP_PASSWORD
- OWNER_EMAIL

Auth/Firebase fallback:
- FIREBASE_WEB_API_KEY (used by auth fallback middleware)

Optional Firebase Admin credential options:
- FIREBASE_SERVICE_ACCOUNT_JSON
- FIREBASE_SERVICE_ACCOUNT_BASE64
- FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
- GOOGLE_APPLICATION_CREDENTIALS

Default admin seed values:
- DEFAULT_ADMIN_NAME
- DEFAULT_ADMIN_EMAIL
- DEFAULT_ADMIN_PASSWORD

Frontend environment expected:
- NEXT_PUBLIC_BACKEND_URL

## 4) CORS Policy

Allowed origins include:
- FRONTEND_URL (if provided)
- http://localhost:3000
- http://127.0.0.1:3000
- https://asianimportexport.com
- https://www.asianimportexport.com

Allowed methods:
- GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD

Allowed headers:
- Content-Type, Authorization

## 5) Data Models

### 5.1 Customer User

Collection: users

Used for customer data only.

Fields:
- firebaseUid: string, required, unique
- companyName: string
- fullName: string, required
- email: string, required, unique, lowercase
- whatsappNumber: string
- country: string
- provider: enum(email, google), default email
- photoURL: string
- role: enum(customer, admin, moderator, user), current customer flows store customer/user
- businessType: string (predefined values are supported, custom values are also allowed)
- createdAt, updatedAt

### 5.2 Authorized Person

Collection: authorizedpeople

Used for admin/moderator records in dashboard/authorized-persons.

Important:
- This CRUD is database-only and does not require Firebase for create/update/delete.
- firebaseUid is optional/sparse in this model.

Fields:
- firebaseUid: string, optional, unique sparse
- fullName: string, required
- email: string, required, unique, lowercase
- provider: enum(email, google), default email
- photoURL: string
- role: enum(admin, moderator), required
- passwordHash: string
- createdAt, updatedAt

## 6) Authentication and Authorization

Middleware:
- authenticate: verifies bearer token
  - Uses Firebase Admin token verification if configured
  - Falls back to Firebase Identity Toolkit lookup using FIREBASE_WEB_API_KEY
- requireAdmin: allows only role=admin

Protected endpoints require:
- Authorization: Bearer <firebase_id_token>

## 7) Endpoint Index

- POST /api/users/register
- GET /api/users/profile/:firebaseUid
- PUT /api/users/profile/:firebaseUid
- GET /api/users
- DELETE /api/users/customers/:firebaseUid
- GET /api/users/authorized-persons
- POST /api/users/authorized-persons
- PUT /api/users/authorized-persons/:firebaseUid
- DELETE /api/users/authorized-persons/:firebaseUid
- POST /api/send-email
- POST /api/send-invoice

## 8) User and Authorized Person APIs

### 8.1 Register/Upsert Customer

Endpoint:
- POST /api/users/register

Description:
- Creates or updates a customer user by firebaseUid.

Request body:
- firebaseUid (required)
- email (required)
- fullName (required)
- companyName, whatsappNumber, country, provider, photoURL, businessType (optional)

Responses:
- 201 created
- 200 updated
- 400 validation errors
- 500 server errors

### 8.2 Get Profile by Firebase UID

Endpoint:
- GET /api/users/profile/:firebaseUid

Description:
- Returns authorized-person profile first if matching firebaseUid exists.
- Otherwise returns customer profile.

Responses:
- 200 success
- 404 not found

### 8.3 Update Profile by Firebase UID

Endpoint:
- PUT /api/users/profile/:firebaseUid

Description:
- If firebaseUid belongs to authorized person, updates authorized-person profile fields.
- Else updates customer profile fields.

### 8.4 Get Customers (Admin only)

Endpoint:
- GET /api/users

Auth:
- Required (authenticate + requireAdmin)

Query params:
- page, limit, search, country, businessType, role(customer|user)

Description:
- Returns customer records from users collection.

### 8.5 Delete Customer (Admin only)

Endpoint:
- DELETE /api/users/customers/:firebaseUid

Auth:
- Required (authenticate + requireAdmin)

Description:
- Deletes customer from users collection.

### 8.6 Get Authorized Persons (Admin only)

Endpoint:
- GET /api/users/authorized-persons

Auth:
- Required (authenticate + requireAdmin)

Description:
- Returns admin/moderator records from authorizedpeople collection.

### 8.7 Create Authorized Person (Admin only, DB-only)

Endpoint:
- POST /api/users/authorized-persons

Auth:
- Required (authenticate + requireAdmin)

Request body:
- fullName (required)
- email (required)
- password (required)
- role (required: admin|moderator)

Behavior:
- Stores authorized person in DB with passwordHash.
- No Firebase create call is required for this flow.

### 8.8 Update Authorized Person (Admin only, DB-only)

Endpoint:
- PUT /api/users/authorized-persons/:firebaseUid

Auth:
- Required (authenticate + requireAdmin)

Path param supports:
- firebaseUid (if present)
- or Mongo _id (frontend fallback for DB-only records)

Request body:
- fullName, email, role, password (optional)

Behavior:
- Updates DB record only.
- If password provided, updates passwordHash.

### 8.9 Delete Authorized Person (Admin only, DB-only)

Endpoint:
- DELETE /api/users/authorized-persons/:firebaseUid

Auth:
- Required (authenticate + requireAdmin)

Path param supports:
- firebaseUid or Mongo _id

Behavior:
- Deletes authorized-person DB record only.

## 9) Email APIs

### 9.1 Send General/Product Inquiry Email

Endpoint:
- POST /api/send-email

Supports:
- product inquiry mode
- general inquiry mode

### 9.2 Send Order Invoice Email

Endpoint:
- POST /api/send-invoice

Sends:
- customer confirmation email
- admin notification email

## 10) cURL Examples

Register customer:
curl -X POST "https://asian-import-export-co-backend.vercel.app/api/users/register" -H "Content-Type: application/json" -d "{\"firebaseUid\":\"uid_123\",\"email\":\"john@example.com\",\"fullName\":\"John Doe\"}"

Get customers (admin token required):
curl "https://asian-import-export-co-backend.vercel.app/api/users?page=1&limit=10" -H "Authorization: Bearer <token>"

Create authorized person (admin token required):
curl -X POST "https://asian-import-export-co-backend.vercel.app/api/users/authorized-persons" -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"fullName\":\"Manager One\",\"email\":\"manager@example.com\",\"password\":\"StrongPass123\",\"role\":\"moderator\"}"

Update authorized person by Mongo id:
curl -X PUT "https://asian-import-export-co-backend.vercel.app/api/users/authorized-persons/67f0abc1234def5678901234" -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"fullName\":\"Manager Updated\",\"password\":\"NewStrongPass123\"}"

Delete authorized person by Mongo id:
curl -X DELETE "https://asian-import-export-co-backend.vercel.app/api/users/authorized-persons/67f0abc1234def5678901234" -H "Authorization: Bearer <token>"

## 11) Current Notes

- Customer and authorized-person data are separated into different collections.
- Admin-only dashboard APIs are protected by authenticate + requireAdmin.
- Authorized-person CRUD is DB-only and independent from customer CRUD.
- Firebase is still used in customer auth flow and token-based route protection.



## 12) category :
get all category:/api/categories 