# Dashboard Implementation Guide

## Backend Changes Summary

### 1. User Model Updates (`models/User.js`)

Added new fields to the User schema:
- **`role`**: String enum (`"user"` or `"admin"`) - Default: `"user"`
  - Controls access to admin features like viewing all users
- **`businessType`**: String value. Predefined business types are supported, and custom values entered via `Other` are stored as-is.
  - Categorizes users by their business type

### 2. New API Endpoint - Get All Users

**Endpoint:** `GET /api/users`

Features:
- Paginated user list (default: 10 per page)
- Search functionality (searches name, email, company, phone)
- Filter by country
- Filter by business type
- Returns total count and pagination info

**Example Usage:**
```javascript
// Fetch page 1 with search
GET /api/users?page=1&limit=10&search=john

// Filter by country
GET /api/users?country=Bangladesh

// Combine filters
GET /api/users?page=1&search=john&country=Bangladesh&businessType=Wholesaler
```

**Response Format:**
```json
{
  "success": true,
  "total": 100,
  "page": 1,
  "limit": 10,
  "totalPages": 10,
  "users": [
    {
      "id": "...",
      "firebaseUid": "...",
      "fullName": "John Doe",
      "email": "john@example.com",
      "companyName": "ABC Company",
      "whatsappNumber": "+880...",
      "country": "Bangladesh",
      "businessType": "Wholesaler",
      "role": "user",
      "createdAt": "2026-03-15T...",
      "updatedAt": "2026-03-15T..."
    }
  ]
}
```

### 3. Updated Controllers

**`controllers/userController.js`** now includes:
- `getAllUsers()` - New function to fetch paginated user list
- Updated `registerUser()` to handle `businessType` field
- Updated `updateUserProfile()` to handle `businessType` field
- All responses now include `role` and `businessType` fields

### 4. Updated Routes

**`routes/userRoutes.js`** now includes:
```javascript
GET /api/users - Get all users (for dashboard)
```

---

## Frontend Implementation Guide

### Step 1: Add Dashboard Link to User Profile Menu

After user login, in the profile dropdown (before "Sign Up" option):

```jsx
// Example in your Header/Navbar component
{user && (
  <div className="profile-dropdown">
    <Link href="/dashboard">Dashboard</Link>
    {!user.emailVerified && <Link href="/signup">Sign Up</Link>}
    <button onClick={handleLogout}>Logout</button>
  </div>
)}
```

### Step 2: Update Place Order Button

Make the "Place Order" button navigate to dashboard:

```jsx
<button onClick={() => router.push('/dashboard')}>
  Place Order
</button>
```

### Step 3: Create Dashboard Page

Create a new page at `/pages/dashboard.js` or `/app/dashboard/page.js`:

```jsx
import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import UserList from '@/components/UserList';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('users');

  return (
    <DashboardLayout activeTab={activeTab} setActiveTab={setActiveTab}>
      {activeTab === 'users' && <UserList />}
      {activeTab === 'orders' && <OrderList />}
      {activeTab === 'profile' && <ProfileSettings />}
    </DashboardLayout>
  );
}
```

### Step 4: Create Dashboard Layout with Sidebar

```jsx
// components/DashboardLayout.js
export default function DashboardLayout({ children, activeTab, setActiveTab }) {
  const { user } = useAuth(); // Your auth context

  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <nav>
          {/* Only show Users tab for admins */}
          {user?.role === 'admin' && (
            <button
              className={activeTab === 'users' ? 'active' : ''}
              onClick={() => setActiveTab('users')}
            >
              <UsersIcon /> Users
            </button>
          )}
          
          <button
            className={activeTab === 'orders' ? 'active' : ''}
            onClick={() => setActiveTab('orders')}
          >
            <OrdersIcon /> Orders
          </button>
          
          <button
            className={activeTab === 'profile' ? 'active' : ''}
            onClick={() => setActiveTab('profile')}
          >
            <ProfileIcon /> Profile
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="dashboard-main">
        {children}
      </main>
    </div>
  );
}
```

### Step 5: Create User List Component

```jsx
// components/UserList.js
import { useState, useEffect } from 'react';

export default function UserList() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    fetchUsers();
  }, [page, search]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${process.env.https://asian-expo-impo-backend-dashbaord.vercel.appL}/api/users?page=${page}&limit=10&search=${search}`
      );
      const data = await response.json();
      
      if (data.success) {
        setUsers(data.users);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="user-list-container">
      {/* Header */}
      <div className="header">
        <h1>All Customers</h1>
        <p>View and manage all customer accounts</p>
        <span className="total-badge">Total: {total}</span>
      </div>

      {/* Search Bar */}
      <div className="search-bar">
        <input
          type="text"
          placeholder="Search by name, email, phone, company..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1); // Reset to first page on search
          }}
        />
      </div>

      {/* Filters */}
      <div className="filters">
        <select onChange={(e) => {/* Filter by country */}}>
          <option value="">All Countries</option>
          <option value="Bangladesh">Bangladesh</option>
          {/* Add more countries */}
        </select>
        
        <select onChange={(e) => {/* Filter by business type */}}>
          <option value="">All Business Types</option>
          <option value="Wholesaler">Wholesaler</option>
          <option value="Retailer">Retailer</option>
          <option value="Other">Other</option>
        </select>
      </div>

      {/* User Table */}
      <div className="table-container">
        {loading ? (
          <div className="loading">Loading...</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Company</th>
                <th>Contact</th>
                <th>Location</th>
                <th>Business Type</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="customer-cell">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt={user.fullName} />
                      ) : (
                        <div className="avatar">{user.fullName[0]}</div>
                      )}
                      <div>
                        <div className="name">{user.fullName}</div>
                        <div className="id">ID: {user.firebaseUid.slice(0, 8)}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="company">{user.companyName}</div>
                    <div className="company-type">{user.provider === 'google' ? 'Google' : 'Email'}</div>
                  </td>
                  <td>
                    <div className="contact">
                      <div className="email">{user.email}</div>
                      <div className="phone">{user.whatsappNumber}</div>
                      {user.whatsappNumber !== 'Not provided' && (
                        <span className="whatsapp-badge">WhatsApp</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="location">
                      <div className="country">{user.country}</div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${user.businessType?.toLowerCase()}`}>
                      {user.businessType}
                    </span>
                  </td>
                  <td>
                    {new Date(user.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </td>
                  <td>
                    <div className="actions">
                      <button className="view-btn" title="View">
                        <EyeIcon />
                      </button>
                      <button className="delete-btn" title="Delete">
                        <TrashIcon />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="pagination">
        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        
        <span>Page {page} of {totalPages}</span>
        
        <button
          disabled={page === totalPages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

### Step 6: Add Styling (Example with Tailwind CSS)

```css
/* styles/dashboard.css or in your component with Tailwind */

.dashboard-container {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 250px;
  background: #1f2937;
  color: white;
  padding: 2rem 1rem;
}

.sidebar button {
  width: 100%;
  padding: 0.75rem 1rem;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border: none;
  background: transparent;
  color: #d1d5db;
  cursor: pointer;
  border-radius: 0.5rem;
  transition: all 0.2s;
}

.sidebar button:hover {
  background: #374151;
}

.sidebar button.active {
  background: #3b82f6;
  color: white;
}

.dashboard-main {
  flex: 1;
  padding: 2rem;
  background: #f3f4f6;
}

.user-list-container {
  background: white;
  border-radius: 0.5rem;
  padding: 1.5rem;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.total-badge {
  background: #fbbf24;
  color: #92400e;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-weight: 600;
}

.search-bar input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.table-container {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead {
  background: #f9fafb;
  border-bottom: 2px solid #e5e7eb;
}

th {
  padding: 0.75rem;
  text-align: left;
  font-weight: 600;
  color: #374151;
}

td {
  padding: 1rem 0.75rem;
  border-bottom: 1px solid #e5e7eb;
}

.customer-cell {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #f59e0b;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
}

.badge {
  padding: 0.25rem 0.75rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.badge.wholesaler {
  background: #dbeafe;
  color: #1e40af;
}

.badge.retailer {
  background: #fce7f3;
  color: #be185d;
}

.badge.other {
  background: #e5e7eb;
  color: #374151;
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.5rem;
}

.pagination button {
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  background: white;
  border-radius: 0.375rem;
  cursor: pointer;
}

.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

---

## Security Recommendations

### 1. Add Admin Middleware (Future Enhancement)

Create `middleware/auth.js`:
```javascript
const User = require('../models/User');

const requireAdmin = async (req, res, next) => {
  try {
    const { firebaseUid } = req.headers;
    
    if (!firebaseUid) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await User.findOne({ firebaseUid });
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

module.exports = { requireAdmin };
```

Then protect the route:
```javascript
const { requireAdmin } = require('../middleware/auth');

// In routes/userRoutes.js
router.get("/", requireAdmin, getAllUsers);
```

### 2. Frontend Protection

In your frontend, check user role before showing admin features:

```javascript
// Context or hook
export function useAuth() {
  const [user, setUser] = useState(null);
  
  // ... Firebase auth logic
  
  // Fetch user role from backend
  useEffect(() => {
    if (firebaseUser) {
      fetch(`/api/users/profile/${firebaseUser.uid}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setUser({ ...firebaseUser, ...data.user });
          }
        });
    }
  }, [firebaseUser]);
  
  return { user, isAdmin: user?.role === 'admin' };
}
```

---

## Testing the API

### Using curl or Postman:

```bash
# Get all users
curl http://localhost:3001/api/users

# Search users
curl "http://localhost:3001/api/users?search=john"

# Filter and paginate
curl "http://localhost:3001/api/users?page=2&limit=5&country=Bangladesh"

# Register user with business type
curl -X POST http://localhost:3001/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "firebaseUid": "test123",
    "fullName": "John Doe",
    "email": "john@example.com",
    "companyName": "ABC Company",
    "businessType": "Wholesaler",
    "country": "Bangladesh"
  }'
```

---

## Next Steps

1. ✅ Backend API endpoints created
2. ⏳ Implement frontend Dashboard page
3. ⏳ Add Dashboard link to user profile menu
4. ⏳ Update Place Order button navigation
5. ⏳ Create UserList component with table display
6. ⏳ Add admin middleware for security
7. ⏳ Implement role-based access control

---

## Files Modified

1. **`models/User.js`** - Added `role` and `businessType` fields
2. **`controllers/userController.js`** - Added `getAllUsers()` function and updated existing functions
3. **`routes/userRoutes.js`** - Added `GET /` route for fetching all users

## Files Created

1. **`API_DOCUMENTATION.md`** - Complete API documentation
2. **`DASHBOARD_IMPLEMENTATION.md`** - This guide

---

## Support

For questions or issues, refer to:
- API_DOCUMENTATION.md for endpoint details
- Check the console for error messages
- Verify MongoDB connection in `.env` file
