const User = require("../models/User");
const AuthorizedPerson = require("../models/AuthorizedPerson");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const ALLOWED_AUTHORIZED_ROLES = ["admin", "moderator"];

const normalizeRole = (role) => (role === "user" ? "customer" : role);
const normalizeOptionalText = (value) => (value === undefined || value === null ? undefined : String(value).trim());
const resolveBusinessType = (value, fallback = "Other") => {
  const normalizedValue = normalizeOptionalText(value);
  return normalizedValue || fallback;
};

const mapUserPayload = (user) => ({
  id: user._id,
  firebaseUid: user.firebaseUid,
  companyName: user.companyName,
  fullName: user.fullName,
  email: user.email,
  whatsappNumber: user.whatsappNumber,
  country: user.country,
  provider: user.provider,
  photoURL: user.photoURL,
  businessType: user.businessType,
  address: user.address || {},
  role: normalizeRole(user.role),
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const mapAuthorizedPayload = (user) => ({
  id: user._id,
  firebaseUid: user.firebaseUid,
  fullName: user.fullName,
  email: user.email,
  provider: user.provider,
  photoURL: user.photoURL,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const findAuthorizedPersonByIdentifier = async (identifier) => {
  const query = [{ firebaseUid: identifier }];
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    query.push({ _id: identifier });
  }

  return AuthorizedPerson.findOne({ $or: query });
};

const createAuthorizedJwt = (authorizedPerson) => {
  const secret = process.env.JWT_SECRET || "local-dev-jwt-secret";
  return jwt.sign(
    {
      sub: String(authorizedPerson._id),
      role: authorizedPerson.role,
      type: "authorized",
      email: authorizedPerson.email,
    },
    secret,
    { expiresIn: "7d" }
  );
};

// Register or update user after Firebase authentication
const registerUser = async (req, res) => {
  try {
    const {
      firebaseUid,
      companyName,
      fullName,
      email,
      whatsappNumber,
      country,
      provider,
      photoURL,
      businessType,
    } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();

    // Validate required fields
    if (!firebaseUid || !normalizedEmail || !fullName) {
      return res.status(400).json({
        success: false,
        message: "Firebase UID, email, and full name are required",
      });
    }

    // Check if user already exists by firebaseUid
    let user = await User.findOne({ firebaseUid });

    if (user) {
      // Update existing user
      user.companyName = companyName || user.companyName;
      user.fullName = fullName || user.fullName;
      user.whatsappNumber = whatsappNumber || user.whatsappNumber;
      user.country = country || user.country;
      user.photoURL = photoURL || user.photoURL;
      user.businessType = resolveBusinessType(businessType, user.businessType || "Other");
      if (provider) user.provider = provider;
      user.role = normalizeRole(user.role);

      await user.save();

      return res.status(200).json({
        success: true,
        message: "User updated successfully",
        user: mapUserPayload(user),
      });
    }

    // Check if email already exists with different firebaseUid
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(400).json({
        success: false,
        message: "Email already registered with another account",
      });
    }

    // Create new user
    user = new User({
      firebaseUid,
      companyName,
      fullName,
      email: normalizedEmail,
      whatsappNumber,
      country,
      provider: provider || "email",
      photoURL,
      businessType: resolveBusinessType(businessType),
      role: "customer",
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: mapUserPayload(user),
    });
  } catch (error) {
    console.error("Register user error:", error);
    res.status(500).json({
      success: false,
      message: "Error registering user",
      error: error.message,
    });
  }
};

// Get user profile by Firebase UID
const getUserProfile = async (req, res) => {
  try {
    const { firebaseUid } = req.params;

    if (!firebaseUid) {
      return res.status(400).json({
        success: false,
        message: "Firebase UID is required",
      });
    }

    const authorizedPerson = await findAuthorizedPersonByIdentifier(firebaseUid);
    const customer = !authorizedPerson
      ? await User.findOne({ firebaseUid })
      : null;

    if (!customer && !authorizedPerson) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const requesterRole = normalizeRole(req.authUser?.role);
    const requesterUid = String(req.authUser?.firebaseUid || "");
    const targetUid = String(firebaseUid || "");
    const isSelf = requesterUid && requesterUid === targetUid;
    const isAdmin = requesterRole === "admin";

    if (!isSelf && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You can only access your own profile",
      });
    }

    res.status(200).json({
      success: true,
      user: authorizedPerson
        ? mapAuthorizedPayload(authorizedPerson)
        : mapUserPayload(customer),
    });
  } catch (error) {
    console.error("Get user profile error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user profile",
      error: error.message,
    });
  }
};

// Update user profile
const updateUserProfile = async (req, res) => {
  try {
    const { firebaseUid } = req.params;
    const { companyName, fullName, whatsappNumber, country, photoURL, businessType, address } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({
        success: false,
        message: "Firebase UID is required",
      });
    }

    const authorizedPerson = await findAuthorizedPersonByIdentifier(firebaseUid);
    const user = !authorizedPerson
      ? await User.findOne({ firebaseUid })
      : null;

    if (!user && !authorizedPerson) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const requesterRole = normalizeRole(req.authUser?.role);
    const requesterUid = String(req.authUser?.firebaseUid || "");
    const targetUid = String(firebaseUid || "");
    const isSelf = requesterUid && requesterUid === targetUid;
    const isAdmin = requesterRole === "admin";

    if (!isSelf && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You can only update your own profile",
      });
    }

    if (authorizedPerson) {
      // Authorized person settings updates (does not touch customer table)
      if (fullName !== undefined) authorizedPerson.fullName = fullName;
      if (photoURL !== undefined) authorizedPerson.photoURL = photoURL;

      await authorizedPerson.save();

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        user: mapAuthorizedPayload(authorizedPerson),
      });
    }

    if (user) {
      // Customer profile updates
      const normalizedCompanyName = normalizeOptionalText(companyName);
      const normalizedFullName = normalizeOptionalText(fullName);
      const normalizedWhatsapp = normalizeOptionalText(whatsappNumber);
      const normalizedCountry = normalizeOptionalText(country);
      const normalizedPhotoURL = normalizeOptionalText(photoURL);
      const normalizedBusinessType = businessType === undefined ? undefined : resolveBusinessType(businessType, user.businessType || "Other");

      if (normalizedCompanyName !== undefined) user.companyName = normalizedCompanyName;
      if (normalizedFullName !== undefined) user.fullName = normalizedFullName;
      if (normalizedWhatsapp !== undefined) user.whatsappNumber = normalizedWhatsapp;
      if (normalizedCountry !== undefined) user.country = normalizedCountry;
      if (normalizedPhotoURL !== undefined) user.photoURL = normalizedPhotoURL;
      if (normalizedBusinessType !== undefined) user.businessType = normalizedBusinessType;
      if (address !== undefined) {
        const nextAddress = typeof address === "object" && address !== null ? address : {};
        user.address = {
          street: normalizeOptionalText(nextAddress.street) ?? user.address?.street ?? "",
          city: normalizeOptionalText(nextAddress.city) ?? user.address?.city ?? "",
          state: normalizeOptionalText(nextAddress.state) ?? user.address?.state ?? "",
          postalCode: normalizeOptionalText(nextAddress.postalCode) ?? user.address?.postalCode ?? "",
          country: normalizeOptionalText(nextAddress.country) ?? user.address?.country ?? "",
        };
      }

      await user.save();

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        user: mapUserPayload(user),
      });
    }

  } catch (error) {
    console.error("Update user profile error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating user profile",
      error: error.message,
    });
  }
};

// Get all users (for admin dashboard)
const getAllUsers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      country = "",
      businessType = "",
      role = "",
    } = req.query;

    // Build query
    const query = { role: { $in: ["customer", "user"] } };

    // Search by name, email, company
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { companyName: { $regex: search, $options: "i" } },
        { whatsappNumber: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by country
    if (country) {
      query.country = country;
    }

    // Filter by business type
    if (businessType) {
      query.businessType = businessType;
    }

    if (role && ["customer", "user"].includes(role)) {
      query.role = role;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get users with pagination
    const users = await User.find(query)
      .select("-__v")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
      users: users.map((user) => ({
        ...mapUserPayload(user),
        companyName: user.companyName || "N/A",
        whatsappNumber: user.whatsappNumber || "Not provided",
        country: user.country || "Not specified",
        businessType: user.businessType || "Other",
      })),
    });
  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching users",
      error: error.message,
    });
  }
};

// Delete user by Firebase UID
const deleteUser = async (req, res) => {
  try {
    const { firebaseUid } = req.params;

    if (!firebaseUid) {
      return res.status(400).json({
        success: false,
        message: "Firebase UID is required",
      });
    }

    if (req.authUser?.firebaseUid === firebaseUid) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const deletedUser = await User.findOneAndDelete({ firebaseUid, role: { $in: ["customer", "user"] } });

    if (!deletedUser) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
      user: {
        id: deletedUser._id,
        firebaseUid: deletedUser.firebaseUid,
        email: deletedUser.email,
      },
    });
  } catch (error) {
    console.error("Delete user error:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting user",
      error: error.message,
    });
  }
};

const getAuthorizedPersons = async (req, res) => {
  try {
    const users = await AuthorizedPerson.find({ role: { $in: ALLOWED_AUTHORIZED_ROLES } })
      .select("-__v")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      users: users.map(mapAuthorizedPayload),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch authorized persons",
      error: error.message,
    });
  }
};

const createAuthorizedPerson = async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();

    if (!fullName || !normalizedEmail || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "fullName, email, password, and role are required",
      });
    }

    if (!ALLOWED_AUTHORIZED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role must be admin or moderator",
      });
    }

    const existingAuthorizedPerson = await AuthorizedPerson.findOne({ email: normalizedEmail });
    if (existingAuthorizedPerson) {
      return res.status(400).json({
        success: false,
        message: "Email already exists as an authorized person",
      });
    }

    const existingCustomer = await User.findOne({ email: normalizedEmail });
    if (existingCustomer) {
      return res.status(400).json({
        success: false,
        message: "Email is already registered to a customer account",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await AuthorizedPerson.create({
      fullName,
      email: normalizedEmail,
      provider: "email",
      role,
      passwordHash,
    });

    return res.status(201).json({
      success: true,
      message: "Authorized person created successfully",
      user: mapAuthorizedPayload(user),
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("createAuthorizedPerson failed:", error, { body: req.body });
    }

    if (error.code === 11000) {
      const message =
        error.message.includes("firebaseUid")
          ? "An authorized person with this Firebase UID already exists"
          : "An account with this email already exists";
      return res.status(400).json({
        success: false,
        message,
        error: error.message,
      });
    }

    const message = error.message || "Failed to create authorized person";
    return res.status(500).json({
      success: false,
      message,
      error: message,
    });
  }
};

const updateAuthorizedPerson = async (req, res) => {
  try {
    const { firebaseUid: identifier } = req.params;
    const { fullName, email, password, role } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();

    const targetUser = await findAuthorizedPersonByIdentifier(identifier);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!ALLOWED_AUTHORIZED_ROLES.includes(targetUser.role)) {
      return res.status(400).json({
        success: false,
        message: "Only admin and moderator can be updated here",
      });
    }

    if (role && !ALLOWED_AUTHORIZED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role must be admin or moderator",
      });
    }

    if (normalizedEmail && normalizedEmail !== targetUser.email) {
      const emailConflict = await AuthorizedPerson.findOne({ email: normalizedEmail });
      if (emailConflict) {
        return res.status(400).json({
          success: false,
          message: "Email already exists",
        });
      }
    }

    if (fullName !== undefined) targetUser.fullName = fullName;
    if (normalizedEmail !== undefined) targetUser.email = normalizedEmail;
    if (role !== undefined) targetUser.role = role;
    if (password !== undefined && password !== "") {
      targetUser.passwordHash = await bcrypt.hash(password, 10);
    }

    await targetUser.save();

    return res.status(200).json({
      success: true,
      message: "Authorized person updated successfully",
      user: mapAuthorizedPayload(targetUser),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to update authorized person",
      error: error.message,
    });
  }
};

const deleteAuthorizedPerson = async (req, res) => {
  try {
    const { firebaseUid: identifier } = req.params;

    if (req.authUser?.firebaseUid && req.authUser.firebaseUid === identifier) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const targetUser = await findAuthorizedPersonByIdentifier(identifier);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!ALLOWED_AUTHORIZED_ROLES.includes(targetUser.role)) {
      return res.status(400).json({
        success: false,
        message: "Only admin and moderator can be deleted here",
      });
    }

    await AuthorizedPerson.deleteOne({ _id: targetUser._id });

    return res.status(200).json({
      success: true,
      message: "Authorized person deleted successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to delete authorized person",
      error: error.message,
    });
  }
};

const loginAuthorizedPerson = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();

    if (!normalizedEmail || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const authorizedPerson = await AuthorizedPerson.findOne({
      email: normalizedEmail,
    });

    if (!authorizedPerson || !authorizedPerson.passwordHash) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const matched = await bcrypt.compare(password, authorizedPerson.passwordHash);
    if (!matched) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const token = createAuthorizedJwt(authorizedPerson);

    return res.status(200).json({
      success: true,
      message: "Authorized login successful",
      token,
      user: mapAuthorizedPayload(authorizedPerson),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to login authorized person",
      error: error.message,
    });
  }
};

module.exports = {
  registerUser,
  getUserProfile,
  updateUserProfile,
  getAllUsers,
  deleteUser,
  getAuthorizedPersons,
  createAuthorizedPerson,
  updateAuthorizedPerson,
  deleteAuthorizedPerson,
  loginAuthorizedPerson,
};
