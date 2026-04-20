import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail
} from "firebase/auth";
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, Timestamp, getDocFromServer, setDoc } from "firebase/firestore";
import { motion, AnimatePresence } from "motion/react";
import { 
  Plus, 
  LogOut, 
  Calendar, 
  ChefHat, 
  History, 
  AlertTriangle, 
  Trash2, 
  CheckCircle2, 
  Utensils, 
  ChevronRight, 
  Search,
  LayoutDashboard,
  Clock,
  ArrowLeft,
  Edit2,
  User as UserIcon,
  Camera,
  Moon,
  Sun,
  Leaf,
  Zap,
  Info,
  RefreshCw,
  Scan,
  X,
  Loader2,
  Check
} from "lucide-react";
import { format, differenceInDays, isPast, isToday, addDays } from "date-fns";
import { getRecipeRecommendations, Recipe, analyzeImageForInventory, AnalyzedItem } from "./services/geminiService";

// --- Types ---
interface FoodItem {
  id: string;
  userId: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  expiryDate: Timestamp;
  status: "available" | "consumed" | "discarded" | "expired";
}

interface UsageHistory {
  id: string;
  userId: string;
  foodName: string;
  action: "consumed" | "discarded";
  quantity: number;
  unit: string;
  timestamp: Timestamp;
}

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  fullName: string;
  age: number;
  origin: string;
  photoURL: string;
  createdAt: Timestamp;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      try {
        const parsed = JSON.parse(event.message);
        if (parsed.error && parsed.operationType) {
          setHasError(true);
          setErrorInfo(`Firestore Error: ${parsed.operationType} on ${parsed.path || 'unknown path'}`);
        }
      } catch (e) {
        // Not a JSON error, ignore
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 dark:bg-gray-950 p-4 transition-colors duration-300">
        <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-xl max-w-md w-full text-center border border-red-100 dark:border-red-900/20">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Terjadi Kesalahan</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{errorInfo || "Maaf, ada masalah saat memproses data."}</p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-3 bg-red-500 text-white rounded-xl font-semibold hover:bg-red-600 transition-colors"
          >
            Muat Ulang Aplikasi
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [history, setHistory] = useState<UsageHistory[]>([]);
  const [activeTab, setActiveTab] = useState<"dashboard" | "add" | "recipes" | "history" | "profile">("dashboard");
  const [editingItem, setEditingItem] = useState<FoodItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"google" | "email">("google");
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [recipes, setRecipes] = useState<Recipe[]>(() => {
    try {
      const saved = localStorage.getItem('dapur_recipes');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipesError, setRecipesError] = useState<string | null>(null);
  const [isRecipesFallback, setIsRecipesFallback] = useState(() => {
    try {
      return localStorage.getItem('dapur_recipes_fallback') === 'true';
    } catch (e) { return false; }
  });

  useEffect(() => {
    try {
      localStorage.setItem('dapur_recipes', JSON.stringify(recipes));
      localStorage.setItem('dapur_recipes_fallback', String(isRecipesFallback));
    } catch (e) {}
  }, [recipes, isRecipesFallback]);

  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved) return saved === 'dark';
    } catch (e) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    console.log('[Theme] Current mode:', isDarkMode ? 'dark' : 'light');
    const root = document.documentElement;
    const body = document.body;
    if (isDarkMode) {
      root.classList.add('dark');
      body.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      body.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Connection Test
  useEffect(() => {
    if (user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if(error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }
      };
      testConnection();
    }
  }, [user]);

  // Firestore Listeners
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const qFood = query(
      collection(db, "foodItems"),
      where("userId", "==", user.uid),
      where("status", "==", "available")
    );

    const qHistory = query(
      collection(db, "usageHistory"),
      where("userId", "==", user.uid)
    );

    const unsubFood = onSnapshot(qFood, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FoodItem));
      setFoodItems(items.sort((a, b) => {
        const timeA = a.expiryDate?.toMillis() || 0;
        const timeB = b.expiryDate?.toMillis() || 0;
        return timeA - timeB;
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "foodItems");
    });

    const unsubHistory = onSnapshot(qHistory, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UsageHistory));
      setHistory(items.sort((a, b) => {
        const timeA = a.timestamp?.toMillis() || Date.now();
        const timeB = b.timestamp?.toMillis() || Date.now();
        return timeB - timeA;
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "usageHistory");
    });

    const unsubProfile = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
      if (docSnap.exists()) {
        setUserProfile(docSnap.data() as UserProfile);
      } else {
        // Initialize profile if it doesn't exist
        const initialProfile: Partial<UserProfile> = {
          uid: user.uid,
          email: user.email || "",
          displayName: user.displayName || "",
          fullName: "",
          age: 0,
          origin: "",
          photoURL: user.photoURL || "",
          createdAt: Timestamp.now()
        };
        setDoc(doc(db, "users", user.uid), initialProfile).catch(e => {
          console.error("Error initializing profile:", e);
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => {
      unsubFood();
      unsubHistory();
      unsubProfile();
    };
  }, [user, isAuthReady]);

  const handleLogin = async () => {
    if (isAuthSubmitting) return;
    setLoginError(null);
    setIsAuthSubmitting(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.code === "auth/popup-closed-by-user") {
        setLoginError("Proses masuk dibatalkan. Silakan coba lagi.");
      } else if (error.code === "auth/popup-blocked") {
        setLoginError("Popup diblokir oleh browser. Silakan izinkan popup untuk masuk.");
      } else if (error.code === "auth/cancelled-popup-request") {
        // This happens if multiple popups are requested, we can just ignore it or show a subtle message
        console.log("Concurrent popup request cancelled");
      } else {
        setLoginError("Gagal masuk. Silakan periksa koneksi internet Anda.");
      }
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsAuthSubmitting(true);

    try {
      if (showForgotPassword) {
        await sendPasswordResetEmail(auth, email);
        setResetSent(true);
      } else if (isSignUp) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: name });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error: any) {
      console.error("Email auth error:", error);
      switch (error.code) {
        case "auth/email-already-in-use":
          setLoginError("Email sudah terdaftar.");
          break;
        case "auth/invalid-email":
          setLoginError("Format email tidak valid.");
          break;
        case "auth/weak-password":
          setLoginError("Kata sandi terlalu lemah (minimal 6 karakter).");
          break;
        case "auth/user-not-found":
        case "auth/wrong-password":
        case "auth/invalid-credential":
          setLoginError("Email atau kata sandi salah.");
          break;
        default:
          setLoginError("Terjadi kesalahan. Silakan coba lagi.");
      }
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleLogout = () => signOut(auth);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50 dark:bg-gray-950 transition-colors duration-300">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full shadow-lg shadow-emerald-100 dark:shadow-none"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div key={isDarkMode ? 'dark-landing' : 'light-landing'} className={isDarkMode ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-[#0a0f12] flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden transition-colors duration-500 relative">
          {/* Theme Toggle - Fixed Position */}
          <div className="fixed top-4 right-4 sm:top-8 sm:right-8 z-[100]">
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="w-10 h-10 sm:w-12 h-12 flex items-center justify-center bg-white dark:bg-white/5 backdrop-blur-md text-gray-900 dark:text-white rounded-xl sm:rounded-2xl border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 shadow-lg transition-all active:scale-95"
              aria-label="Toggle Theme"
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>

          {/* Background Decorative Elements */}
          <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 dark:bg-emerald-900/20 rounded-full blur-[120px]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/5 dark:bg-emerald-900/10 rounded-full blur-[120px]" />
          </div>

          {/* Left Side - Content & Branding */}
          <div className="w-full lg:w-1/2 flex flex-col justify-center p-6 sm:p-12 lg:p-24 relative z-10">
            <motion.div 
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              className="max-w-xl mx-auto lg:mx-0"
            >
              <div className="flex items-center gap-2 mb-8 lg:mb-12">
                <span className="text-emerald-600 dark:text-emerald-500 font-bold tracking-tight text-xl">Dapur Pintar</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-black text-gray-900 dark:text-white mb-6 lg:mb-8 leading-[1.1] tracking-tight">
                Kelola dapur jadi lebih cerdas dengan <span className="text-emerald-600 dark:text-emerald-400">AI</span>
              </h1>
              
              <p className="text-base sm:text-lg lg:text-xl text-gray-600 dark:text-gray-400 font-medium leading-relaxed mb-8 lg:mb-12">
                Optimalkan inventaris makanan, kurangi limbah, dan temukan resep berbasis AI yang dirancang khusus untuk kesehatan dan gaya hidup Anda.
              </p>

              {/* Feature Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 lg:mb-12">
                <div className="bg-white dark:bg-[#121a1e]/50 backdrop-blur-md border border-gray-100 dark:border-white/5 p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] group hover:shadow-xl dark:hover:bg-[#121a1e] transition-all">
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Leaf className="w-5 h-5 text-emerald-600 dark:text-emerald-500" />
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white mb-1">95%</div>
                  <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Food Waste Reduction</div>
                </div>
                <div className="bg-white dark:bg-[#121a1e]/50 backdrop-blur-md border border-gray-100 dark:border-white/5 p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] group hover:shadow-xl dark:hover:bg-[#121a1e] transition-all">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                    <Zap className="w-5 h-5 text-blue-600 dark:text-blue-500" />
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white mb-1">Smart</div>
                  <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Efficiency</div>
                </div>
              </div>

              {/* AI Recipe Card */}
              <div className="bg-white dark:bg-[#121a1e]/50 backdrop-blur-md border border-gray-100 dark:border-white/5 p-5 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] flex items-center justify-between mb-8 lg:mb-12 group hover:shadow-xl dark:hover:bg-[#121a1e] transition-all">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 sm:w-12 h-12 bg-emerald-500/10 rounded-xl sm:rounded-2xl flex items-center justify-center group-hover:rotate-12 transition-transform">
                    <ChefHat className="w-5 h-5 sm:w-6 h-6 text-emerald-600 dark:text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">AI-Powered Recipes</h3>
                    <p className="text-[10px] sm:text-xs text-gray-500">Personalized meal plans generated daily</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 sm:px-4 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full shrink-0 shadow-sm shadow-emerald-500/5">
                  <motion.div 
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                  />
                  <span className="text-[9px] sm:text-[11px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-[0.1em] whitespace-nowrap">
                    Live AI
                  </span>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Right Side - Login Form */}
          <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 lg:p-24 relative z-10">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-md bg-white dark:bg-[#121a1e] p-6 sm:p-10 lg:p-12 rounded-[2rem] sm:rounded-[3rem] border border-gray-100 dark:border-white/5 shadow-2xl mb-32 lg:mb-0"
            >
              <div className="mb-6 sm:mb-10">
                <h2 className="text-2xl sm:text-3xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">
                  {authMode === "google" 
                    ? "Selamat Datang Kembali" 
                    : (showForgotPassword 
                        ? "Lupa Kata Sandi?" 
                        : (isSignUp ? "Daftar Sekarang" : "Masuk ke Dashboard"))}
                </h2>
                <p className="text-gray-500 font-medium">
                  {authMode === "google" 
                    ? "Lanjutkan perjalanan dapur pintar Anda." 
                    : (showForgotPassword 
                        ? "Masukkan email Anda untuk menerima tautan reset." 
                        : (isSignUp ? "Lengkapi detail di bawah untuk mendaftar." : "Lanjutkan perjalanan dapur pintar Anda.")) }
                </p>
              </div>

              {loginError && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-8 p-4 bg-red-500/10 text-red-600 dark:text-red-400 text-sm rounded-2xl border border-red-500/20 flex items-center gap-3"
                >
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span className="font-medium">{loginError}</span>
                </motion.div>
              )}

              <AnimatePresence mode="wait">
                {authMode === "google" ? (
                  <motion.div
                    key="google-mode"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="space-y-6"
                  >
                    <button 
                      disabled={isAuthSubmitting}
                      onClick={handleLogin}
                      className="w-full flex items-center justify-center gap-3 sm:gap-4 py-4 sm:py-5 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 text-gray-900 dark:text-white rounded-xl sm:rounded-2xl font-bold transition-all border border-gray-200 dark:border-white/10 shadow-sm group disabled:opacity-50"
                    >
                      {isAuthSubmitting ? (
                        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-5 h-5 sm:w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
                      ) : (
                        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5 sm:w-6 h-6" alt="Google" />
                      )}
                      <span className="text-sm sm:text-base">{isAuthSubmitting ? "Memproses..." : "Continue with Google"}</span>
                    </button>

                    <div className="relative py-4">
                      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200 dark:border-white/5"></div></div>
                      <div className="relative flex justify-center text-[10px] uppercase"><span className="bg-white dark:bg-[#121a1e] px-4 text-gray-400 dark:text-gray-500 font-black tracking-[0.2em]">Atau gunakan email</span></div>
                    </div>

                    <button 
                      onClick={() => setAuthMode("email")}
                      className="w-full py-4 sm:py-5 bg-emerald-600 dark:bg-emerald-500 text-white rounded-xl sm:rounded-2xl font-bold hover:bg-emerald-700 dark:hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 text-sm sm:text-base"
                    >
                      Masuk ke Dashboard
                    </button>

                    <div className="text-center">
                      <p className="text-sm text-gray-500 font-medium">
                        Belum punya akun? <button onClick={() => { setAuthMode("email"); setIsSignUp(true); }} className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline">Daftar sekarang</button>
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.form
                    key="email-mode"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    onSubmit={handleEmailAuth}
                    className="space-y-6"
                  >
                    {resetSent ? (
                      <div className="p-8 bg-emerald-500/10 border border-emerald-500/20 rounded-[2rem] text-center space-y-4">
                        <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                          <CheckCircle2 className="text-emerald-600 dark:text-emerald-400 w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 dark:text-white">Email Terkirim!</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Silakan periksa kotak masuk Anda untuk instruksi reset kata sandi.</p>
                        <button 
                          type="button"
                          onClick={() => {
                            setShowForgotPassword(false);
                            setResetSent(false);
                          }}
                          className="w-full py-4 bg-emerald-600 dark:bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-700 dark:hover:bg-emerald-600 transition-all"
                        >
                          Kembali ke Login
                        </button>
                      </div>
                    ) : (
                      <>
                        {isSignUp && !showForgotPassword && (
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Nama Lengkap</label>
                            <input 
                              required
                              type="text"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="w-full px-6 py-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-700"
                              placeholder="Nama Anda"
                            />
                          </div>
                        )}
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Email</label>
                          <input 
                            required
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-6 py-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-700"
                            placeholder="nama@email.com"
                          />
                        </div>
                        {!showForgotPassword && (
                          <div className="space-y-2">
                            <div className="flex justify-between items-center ml-1">
                              <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Password</label>
                              {!isSignUp && (
                                <button 
                                  type="button"
                                  onClick={() => setShowForgotPassword(true)}
                                  className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 uppercase tracking-widest"
                                >
                                  Lupa password?
                                </button>
                              )}
                            </div>
                            <input 
                              required
                              type="password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              className="w-full px-6 py-4 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-700"
                              placeholder="••••••••"
                            />
                          </div>
                        )}

                        <button 
                          disabled={isAuthSubmitting}
                          type="submit"
                          className="w-full py-5 bg-emerald-600 dark:bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-700 dark:hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-3"
                        >
                          {isAuthSubmitting ? (
                            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                          ) : (
                            <span>
                              {showForgotPassword 
                                ? "Kirim Tautan Reset" 
                                : (isSignUp ? "Daftar Sekarang" : "Masuk ke Dashboard")}
                            </span>
                          )}
                        </button>

                        <div className="flex flex-col gap-4 pt-4 text-center">
                          {!showForgotPassword ? (
                            <p className="text-sm text-gray-500 font-medium">
                              {isSignUp ? "Sudah punya akun?" : "Belum punya akun?"} <button type="button" onClick={() => setIsSignUp(!isSignUp)} className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline">{isSignUp ? "Masuk sekarang" : "Daftar sekarang"}</button>
                            </p>
                          ) : (
                            <button 
                              type="button"
                              onClick={() => setShowForgotPassword(false)}
                              className="text-sm font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                            >
                              Kembali ke Login
                            </button>
                          )}
                          <button 
                            type="button"
                            onClick={() => {
                              setAuthMode("google");
                              setLoginError(null);
                              setShowForgotPassword(false);
                            }}
                            className="text-xs font-bold text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest"
                          >
                            Kembali ke Pilihan Lain
                          </button>
                        </div>
                      </>
                    )}
                  </motion.form>
                )}
              </AnimatePresence>
            </motion.div>
          </div>

          {/* Footer */}
          <footer className="lg:absolute lg:bottom-0 lg:left-0 w-full p-6 sm:p-8 flex flex-col lg:flex-row items-center justify-between gap-6 z-20 bg-white/80 dark:bg-[#0a0f12]/80 backdrop-blur-sm lg:bg-transparent border-t border-gray-100 dark:border-transparent">
            <div className="text-gray-900 dark:text-white font-bold text-lg">Dapur Pintar</div>
            <div className="text-[9px] sm:text-[10px] text-gray-400 dark:text-gray-600 font-medium uppercase tracking-widest text-center max-w-[250px] sm:max-w-none">
              © 2025 DAPUR PINTAR AI. ENGINEERED FOR THE ETHEREAL ENGINE.
            </div>
            <div className="flex items-center gap-4 sm:gap-6">
              {['PRIVACY POLICY', 'TERMS', 'CONTACT'].map(link => (
                <button key={link} className="text-[9px] sm:text-[10px] text-gray-400 dark:text-gray-600 font-bold hover:text-emerald-600 dark:hover:text-gray-400 transition-colors uppercase tracking-widest">
                  {link}
                </button>
              ))}
            </div>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div key={isDarkMode ? 'dark-app' : 'light-app'} className={isDarkMode ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-32 transition-colors duration-300">
        {/* Modern Header */}
        <header className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl px-6 py-5 flex items-center justify-between sticky top-0 z-40 border-b border-gray-100 dark:border-gray-800 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-100 dark:shadow-none">
              <Utensils className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-none mb-1">DapurPintar</h1>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sistem Aktif</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-bold text-gray-900 dark:text-gray-100">{user.displayName || "Pengguna"}</span>
              <span className="text-[10px] text-gray-400 font-medium">{user.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="w-10 h-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-gray-800 transition-all"
                title={isDarkMode ? "Mode Terang" : "Mode Gelap"}
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
              <button 
                onClick={() => setActiveTab("profile")}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all overflow-hidden ${activeTab === "profile" ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 ring-2 ring-emerald-500" : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-gray-800"}`}
                title="Edit Profil"
              >
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon className="w-5 h-5" />
                )}
              </button>
              <button 
                onClick={handleLogout}
                className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                title="Keluar"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-5xl mx-auto p-6">
          <AnimatePresence mode="wait">
            {activeTab === "dashboard" && (
              <Dashboard 
                key="dashboard" 
                foodItems={foodItems} 
                setActiveTab={setActiveTab} 
                onEdit={(item) => {
                  setEditingItem(item);
                  setActiveTab("add");
                }}
              />
            )}
            {activeTab === "add" && (
              <AddFood 
                key="add" 
                editingItem={editingItem}
                onComplete={() => {
                  setEditingItem(null);
                  setActiveTab("dashboard");
                }} 
              />
            )}
            {activeTab === "recipes" && (
              <RecipeRecommendations 
                key="recipes" 
                foodItems={foodItems} 
                recipes={recipes}
                setRecipes={setRecipes}
                loading={recipesLoading}
                setLoading={setRecipesLoading}
                error={recipesError}
                setError={setRecipesError}
                isFallback={isRecipesFallback}
                setIsFallback={setIsRecipesFallback}
              />
            )}
            {activeTab === "history" && (
              <HistoryView key="history" history={history} />
            )}
            {activeTab === "profile" && (
              <ProfileView key="profile" user={user} userProfile={userProfile} />
            )}
          </AnimatePresence>
        </main>

        {/* Floating Navigation Bar */}
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-3rem)] max-w-md">
          <nav className="bg-gray-900/90 backdrop-blur-xl rounded-3xl p-2 flex justify-between items-center shadow-2xl shadow-gray-900/20 border border-white/10">
            <NavButton 
              active={activeTab === "dashboard"} 
              onClick={() => setActiveTab("dashboard")} 
              icon={<LayoutDashboard />} 
              label="Home" 
            />
            <NavButton 
              active={activeTab === "add"} 
              onClick={() => setActiveTab("add")} 
              icon={<Plus />} 
              label="Tambah" 
            />
            <NavButton 
              active={activeTab === "recipes"} 
              onClick={() => setActiveTab("recipes")} 
              icon={<ChefHat />} 
              label="Resep" 
            />
            <NavButton 
              active={activeTab === "history"} 
              onClick={() => setActiveTab("history")} 
              icon={<History />} 
              label="Riwayat" 
            />
          </nav>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  );
}

// --- Sub-components ---

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`relative flex-1 flex flex-col items-center gap-1 py-3 transition-all rounded-2xl ${active ? 'text-white' : 'text-gray-500 hover:text-gray-300'}`}
    >
      {active && (
        <motion.div 
          layoutId="nav-active"
          className="absolute inset-0 bg-emerald-600 rounded-2xl -z-10"
          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
        />
      )}
      <div className="relative">
        {React.cloneElement(icon as React.ReactElement<any>, { size: 20 })}
      </div>
      <span className="text-[9px] font-bold uppercase tracking-[0.15em]">{label}</span>
    </button>
  );
}

function Dashboard({ foodItems, setActiveTab, onEdit }: { foodItems: FoodItem[], setActiveTab: (tab: any) => void, onEdit: (item: FoodItem) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const filteredItems = foodItems.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const expiringSoon = foodItems.filter(item => {
    const date = item.expiryDate?.toDate();
    if (!date) return false;
    const days = differenceInDays(date, new Date());
    return days >= 0 && days <= 3;
  });

  const expired = foodItems.filter(item => {
    const date = item.expiryDate?.toDate();
    if (!date) return false;
    return isPast(date) && !isToday(date);
  });

  const handleAction = async (item: FoodItem, action: "consumed" | "discarded") => {
    try {
      // Delete from active inventory instead of just updating status
      await deleteDoc(doc(db, "foodItems", item.id));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `foodItems/${item.id}`);
    }

    try {
      await addDoc(collection(db, "usageHistory"), {
        userId: auth.currentUser?.uid,
        foodName: item.name,
        action,
        quantity: item.quantity,
        unit: item.unit,
        timestamp: serverTimestamp()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, "usageHistory");
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      {/* Stats Bento Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          label="Total Stok" 
          value={foodItems.length} 
          icon={<Utensils className="text-emerald-600" />} 
          color="bg-emerald-50"
        />
        <StatCard 
          label="Segera Habis" 
          value={expiringSoon.length} 
          icon={<Clock className="text-amber-600" />} 
          color="bg-amber-50"
        />
        <StatCard 
          label="Kedaluwarsa" 
          value={expired.length} 
          icon={<AlertTriangle className="text-red-600" />} 
          color="bg-red-50"
        />
        <StatCard 
          label="Kategori" 
          value={new Set(foodItems.map(i => i.category)).size} 
          icon={<LayoutDashboard className="text-blue-600" />} 
          color="bg-blue-50"
        />
      </div>

      {/* Alerts Section */}
      {(expiringSoon.length > 0 || expired.length > 0) && (
        <section className="space-y-4">
          <h2 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em]">Peringatan Penting</h2>
          <div className="grid gap-3">
            {expired.map(item => (
              <motion.div 
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                key={item.id} 
                className="bg-red-50/50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 p-4 rounded-3xl flex items-center gap-4 group transition-colors"
              >
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-red-900 dark:text-red-200">{item.name}</h3>
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">Sudah kedaluwarsa sejak {item.expiryDate ? format(item.expiryDate.toDate(), "dd MMM") : "..."}</p>
                </div>
                <button 
                  onClick={() => handleAction(item, "discarded")} 
                  className="w-10 h-10 flex items-center justify-center bg-white dark:bg-gray-800 text-red-400 hover:text-red-600 rounded-xl shadow-sm transition-all"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </motion.div>
            ))}
            {expiringSoon.map(item => (
              <motion.div 
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                key={item.id} 
                className="bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20 p-4 rounded-3xl flex items-center gap-4 transition-colors"
              >
                <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <Clock className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-amber-900 dark:text-amber-200">{item.name}</h3>
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Kedaluwarsa dalam {item.expiryDate ? differenceInDays(item.expiryDate.toDate(), new Date()) : "..."} hari</p>
                </div>
                <button 
                  onClick={() => handleAction(item, "consumed")} 
                  className="w-10 h-10 flex items-center justify-center bg-white dark:bg-gray-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-xl shadow-sm transition-all"
                >
                  <CheckCircle2 className="w-5 h-5" />
                </button>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Main Inventory */}
      <section className="space-y-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-extrabold text-gray-900 dark:text-white tracking-tight">Inventaris Dapur</h2>
              <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">Kelola semua stok makanan Anda di sini.</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setShowSearch(!showSearch)}
                className={`p-3 rounded-2xl transition-all shadow-sm border ${showSearch ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-gray-900 text-gray-400 border-gray-100 dark:border-gray-800 hover:text-emerald-600'}`}
              >
                <Search size={20} />
              </button>
            </div>
          </div>

          <AnimatePresence>
            {showSearch && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Cari nama makanan atau kategori..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 rounded-2xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery("")}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-gray-600"
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {foodItems.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 p-16 rounded-[2.5rem] border-2 border-dashed border-gray-100 dark:border-gray-800 text-center transition-colors">
            <div className="w-20 h-20 bg-gray-50 dark:bg-gray-800 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Plus className="w-10 h-10 text-gray-200 dark:text-gray-700" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Dapur Masih Kosong</h3>
            <p className="text-gray-400 dark:text-gray-500 font-medium mb-8">Mulai tambahkan stok makanan Anda untuk mendapatkan pengingat cerdas.</p>
            <button 
              onClick={() => setActiveTab("add")}
              className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 dark:shadow-none"
            >
              Tambah Sekarang
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 p-12 rounded-[2.5rem] border border-gray-100 dark:border-gray-800 text-center transition-colors">
            <Search className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Tidak Ditemukan</h3>
            <p className="text-sm text-gray-400 dark:text-gray-500">Hasil pencarian untuk "{searchQuery}" tidak ada.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredItems.map((item, idx) => (
              <motion.div 
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
                key={item.id} 
                className="bg-white dark:bg-gray-900 p-5 rounded-[2rem] shadow-sm border border-gray-100 dark:border-gray-800 flex items-center gap-5 group hover:shadow-xl hover:shadow-gray-200/50 dark:hover:shadow-emerald-900/10 transition-all duration-300"
              >
                <div className="w-14 h-14 bg-gray-50 dark:bg-gray-800 rounded-2xl flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-900/20 transition-colors duration-300">
                  <Utensils className="w-7 h-7 text-gray-300 dark:text-gray-700 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors duration-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900 dark:text-white truncate">{item.name}</h3>
                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest rounded-md">
                      {item.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                      {item.quantity} {item.unit}
                    </div>
                    <div className="flex items-center gap-1 text-xs font-bold text-gray-400 dark:text-gray-500">
                      <Calendar size={12} />
                      {item.expiryDate ? format(item.expiryDate.toDate(), "dd MMM") : "..."}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleAction(item, "consumed")}
                      className="w-9 h-9 flex items-center justify-center bg-gray-50 dark:bg-gray-800 text-gray-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/40 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-xl transition-all"
                      title="Tandai sudah dikonsumsi"
                    >
                      <CheckCircle2 size={18} />
                    </button>
                    <button 
                      onClick={() => onEdit(item)}
                      className="w-9 h-9 flex items-center justify-center bg-gray-50 dark:bg-gray-800 text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/40 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl transition-all"
                      title="Edit bahan"
                    >
                      <Edit2 size={16} />
                    </button>
                  </div>
                  <button 
                    onClick={() => handleAction(item, "discarded")}
                    className="w-9 h-9 flex items-center justify-center bg-gray-50 dark:bg-gray-800 text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/40 hover:text-red-500 dark:hover:text-red-400 rounded-xl transition-all w-full"
                    title="Buang (kedaluwarsa/rusak)"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </motion.div>
  );
}

function StatCard({ label, value, icon, color }: { label: string, value: number | string, icon: React.ReactNode, color: string }) {
  return (
    <div className="bg-white dark:bg-gray-900 p-5 rounded-[2rem] border border-gray-100 dark:border-gray-800 shadow-sm transition-colors">
      <div className={`w-10 h-10 ${color} dark:bg-opacity-10 rounded-xl flex items-center justify-center mb-4`}>
        {React.cloneElement(icon as React.ReactElement<any>, { size: 20 })}
      </div>
      <div className="text-2xl font-black text-gray-900 dark:text-white mb-0.5">{value}</div>
      <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{label}</div>
    </div>
  );
}

function SmartScanModal({ 
  onClose, 
  onDetected 
}: { 
  onClose: () => void, 
  onDetected: (items: AnalyzedItem[]) => void 
}) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedItems, setDetectedItems] = useState<AnalyzedItem[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<"scan" | "review">("scan");

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        // Explicitly play for mobile browsers
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(e => console.error("Video play error:", e));
        };
      }
    } catch (err) {
      setError("Gagal mengakses kamera. Pastikan izin diberikan.");
    }
  };

  useEffect(() => {
    if (step === "scan") {
      startCamera();
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
      }
    };
  }, [step]);

  const captureAndAnalyze = async () => {
    if (!videoRef.current) return;
    setIsScanning(true);
    setError(null);

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0);
    
    const base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
    
    try {
      const result = await analyzeImageForInventory(base64, "image/jpeg");
      if (result.length > 0) {
        setDetectedItems(result);
        setSelectedIndices(new Set(result.map((_, i) => i)));
        setStep("review");
      } else {
        setError("Tidak ada item makanan yang terdeteksi. Coba lagi.");
      }
    } catch (err: any) {
      setError(err.message || "Gagal menganalisis gambar.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    setError(null);

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = (reader.result as string).split(",")[1];
      try {
        const result = await analyzeImageForInventory(base64, file.type);
        if (result.length > 0) {
          setDetectedItems(result);
          setSelectedIndices(new Set(result.map((_, i) => i)));
          setStep("review");
        } else {
          setError("Tidak ada item makanan yang terdeteksi.");
        }
      } catch (err: any) {
        setError(err.message || "Gagal menganalisis gambar.");
      } finally {
        setIsScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleSelection = (index: number) => {
    const next = new Set(selectedIndices);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelectedIndices(next);
  };

  const confirmSelection = () => {
    const selected = detectedItems.filter((_, i) => selectedIndices.has(i));
    onDetected(selected);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-[2.5rem] overflow-hidden shadow-2xl relative flex flex-col max-h-[90vh]"
      >
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
              <Zap className="text-emerald-600 dark:text-emerald-400" size={20} />
            </div>
            <div>
              <h3 className="font-black text-gray-900 dark:text-white">
                {step === "scan" ? "Smart Scan" : "Tinjau Hasil"}
              </h3>
              <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">
                {step === "scan" ? "AI Inventory Bot" : `${selectedIndices.size} item dipilih`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          {step === "scan" ? (
            <div className="space-y-6">
              <div className="aspect-video bg-gray-100 dark:bg-gray-800 rounded-[2rem] overflow-hidden relative border-2 border-dashed border-gray-200 dark:border-gray-700">
                {stream ? (
                  <>
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute inset-0 border-[2rem] border-black/20 pointer-events-none">
                      <div className="w-full h-full border-2 border-emerald-400/50 rounded-lg relative">
                        <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-400 -mt-1 -ml-1" />
                        <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-400 -mt-1 -mr-1" />
                        <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-400 -mb-1 -ml-1" />
                        <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-400 -mb-1 -mr-1" />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 gap-2 p-8 text-center">
                    <Camera size={48} strokeWidth={1} />
                    <p className="text-sm font-medium">Memulai kamera...</p>
                    <p className="text-xs">Arahkan ke Barcode atau Struk Belanja</p>
                  </div>
                )}
                
                {isScanning && (
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white backdrop-blur-[2px]">
                    <Loader2 className="w-10 h-10 animate-spin mb-3" />
                    <p className="font-bold tracking-wide">Menganalisis...</p>
                  </div>
                )}
              </div>

              {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 rounded-2xl flex items-center gap-3 text-red-600 dark:text-red-400 text-xs font-medium">
                  <AlertTriangle size={16} />
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <button 
                  onClick={captureAndAnalyze}
                  disabled={isScanning || !stream}
                  className="py-4 bg-emerald-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 dark:shadow-none hover:bg-emerald-700 transition-all disabled:opacity-50"
                >
                  <Scan size={20} />
                  Ambil Foto
                </button>
                <label className="py-4 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-2xl font-bold flex items-center justify-center gap-2 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-all">
                  <Camera size={20} />
                  Upload Struk
                  <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-gray-500 mb-2 font-medium">
                Kami menemukan {detectedItems.length} item. Pilih produk yang ingin Anda tambahkan ke inventaris dapur.
              </div>
              <div className="space-y-3">
                {detectedItems.map((item, idx) => (
                  <div 
                    key={idx}
                    onClick={() => toggleSelection(idx)}
                    className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                      selectedIndices.has(idx) 
                        ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-900/10" 
                        : "border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                        selectedIndices.has(idx) ? "bg-emerald-500 border-emerald-500" : "border-gray-300 dark:border-gray-600"
                      }`}>
                        {selectedIndices.has(idx) && <Check size={14} className="text-white" />}
                      </div>
                      <div>
                        <div className="font-bold text-gray-900 dark:text-white text-sm">{item.name}</div>
                        <div className="text-[10px] uppercase font-black text-gray-400 flex gap-2">
                          <span>{item.category}</span>
                          <span>•</span>
                          <span>{item.quantity} {item.unit}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {step === "review" && (
          <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20 grid grid-cols-2 gap-4">
            <button 
              onClick={() => setStep("scan")}
              className="py-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-2xl font-bold hover:bg-gray-50 transition-all"
            >
              Scan Ulang
            </button>
            <button 
              onClick={confirmSelection}
              disabled={selectedIndices.size === 0}
              className="py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-lg shadow-emerald-100 dark:shadow-none hover:bg-emerald-700 transition-all disabled:opacity-50"
            >
              Tambah ({selectedIndices.size})
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function AddFood({ onComplete, editingItem }: { onComplete: () => void, editingItem?: FoodItem | null }) {
  const [name, setName] = useState(editingItem?.name || "");
  const [category, setCategory] = useState(editingItem?.category || "Lainnya");
  const [quantity, setQuantity] = useState(editingItem?.quantity?.toString() || "");
  const [unit, setUnit] = useState(editingItem?.unit || "pcs");
  const [expiryDate, setExpiryDate] = useState(
    editingItem?.expiryDate 
      ? format(editingItem.expiryDate.toDate(), "yyyy-MM-dd") 
      : format(addDays(new Date(), 7), "yyyy-MM-dd")
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSmartScan, setShowSmartScan] = useState(false);

  const handleSmartScan = async (items: AnalyzedItem[]) => {
    // If multiple items, we bulk create them in Firestore
    if (items.length > 1) {
      setIsSubmitting(true);
      try {
        const batchPromises = items.map(item => {
          const futureDate = addDays(new Date(), item.estimatedExpiryDays);
          const foodData = {
            userId: auth.currentUser?.uid,
            name: item.name,
            category: item.category,
            quantity: Number(item.quantity) || 1,
            unit: item.unit || "pcs",
            expiryDate: Timestamp.fromDate(futureDate),
            status: "available" as const,
            updatedAt: serverTimestamp(),
            addedAt: serverTimestamp()
          };
          return addDoc(collection(db, "foodItems"), foodData);
        });
        
        await Promise.all(batchPromises);
        onComplete();
      } catch (e) {
        console.error("Bulk add error:", e);
      } finally {
        setIsSubmitting(false);
      }
    } else if (items.length === 1) {
      // If only one item, fill the form
      const item = items[0];
      setName(item.name);
      setCategory(item.category);
      setQuantity(item.quantity.toString());
      setUnit(item.unit);
      
      const futureDate = addDays(new Date(), item.estimatedExpiryDays);
      setExpiryDate(format(futureDate, "yyyy-MM-dd"));
    }
  };

  const categories = ["Sayuran", "Buah", "Daging", "Susu", "Bumbu", "Camilan", "Lainnya"];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const foodData = {
        userId: auth.currentUser?.uid,
        name,
        category,
        quantity: Number(quantity) || 0,
        unit,
        expiryDate: Timestamp.fromDate(new Date(expiryDate)),
        status: "available" as const,
        updatedAt: serverTimestamp()
      };

      if (editingItem) {
        await updateDoc(doc(db, "foodItems", editingItem.id), foodData);
      } else {
        await addDoc(collection(db, "foodItems"), {
          ...foodData,
          addedAt: serverTimestamp()
        });
      }
      
      // Reset state and call onComplete immediately
      setIsSubmitting(false);
      onComplete();
    } catch (e) {
      setIsSubmitting(false);
      handleFirestoreError(e, editingItem ? OperationType.UPDATE : OperationType.CREATE, editingItem ? `foodItems/${editingItem.id}` : "foodItems");
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white dark:bg-gray-900 p-8 rounded-[2.5rem] shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800 max-w-xl mx-auto transition-colors"
    >
      <div className="flex items-center justify-between gap-4 mb-10">
        <div className="flex items-center gap-4">
          <button onClick={onComplete} className="w-12 h-12 flex items-center justify-center bg-gray-50 dark:bg-gray-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-gray-400 hover:text-emerald-600 rounded-2xl transition-all">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
              {editingItem ? "Edit Stok" : "Tambah Stok"}
            </h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">
              {editingItem ? "Perbarui detail bahan makanan Anda." : "Masukkan detail bahan makanan baru."}
            </p>
          </div>
        </div>
        {!editingItem && (
          <button 
            type="button"
            onClick={() => setShowSmartScan(true)}
            className="flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-200 dark:shadow-none hover:bg-emerald-700 transition-all"
          >
            <Zap size={14} className="fill-white" />
            Smart Scan
          </button>
        )}
      </div>

      {showSmartScan && (
        <SmartScanModal 
          onClose={() => setShowSmartScan(false)} 
          onDetected={handleSmartScan}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="space-y-3">
          <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Nama Makanan</label>
          <input 
            required
            type="text" 
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Contoh: Telur Ayam Kampung"
            className="w-full px-6 py-5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent rounded-[1.5rem] focus:bg-white dark:focus:bg-gray-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Jumlah & Satuan</label>
            <div className="flex items-center bg-gray-50 dark:bg-gray-800 rounded-[1.5rem] border-2 border-transparent focus-within:bg-white dark:focus-within:bg-gray-900 focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/10 transition-all">
              <input 
                type="number" 
                step="0.1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="0"
                className="w-full px-6 py-5 bg-transparent border-none focus:ring-0 font-bold text-gray-900 dark:text-white no-spinner"
              />
              <select 
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="bg-emerald-50 dark:bg-emerald-900/20 border-none focus:ring-0 text-xs font-black text-emerald-600 dark:text-emerald-400 px-4 py-2 rounded-xl mr-3"
              >
                <option>pcs</option>
                <option>kg</option>
                <option>gr</option>
                <option>liter</option>
                <option>box</option>
              </select>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Kategori</label>
            <select 
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-6 py-5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent rounded-[1.5rem] focus:bg-white dark:focus:bg-gray-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white"
            >
              {categories.map(c => <option key={c} className="dark:bg-gray-900">{c}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Tanggal Kedaluwarsa</label>
          <div className="relative group">
            <Calendar className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300 dark:text-gray-700 group-focus-within:text-emerald-500 transition-colors" />
            <input 
              required
              type="date" 
              value={expiryDate}
              onChange={e => setExpiryDate(e.target.value)}
              className="w-full pl-16 pr-6 py-5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent rounded-[1.5rem] focus:bg-white dark:focus:bg-gray-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white"
            />
          </div>
        </div>

        <button 
          disabled={isSubmitting}
          type="submit"
          className="w-full py-5 bg-emerald-600 text-white rounded-[1.5rem] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 dark:shadow-none disabled:opacity-50 flex items-center justify-center gap-3"
        >
          {isSubmitting ? (
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
          ) : (
            <>
              {editingItem ? <Edit2 size={20} /> : <Plus size={20} />}
              {editingItem ? "Simpan Perubahan" : "Simpan ke Inventaris"}
            </>
          )}
        </button>
      </form>
    </motion.div>
  );
}

function RecipeRecommendations({ 
  foodItems, 
  recipes, 
  setRecipes, 
  loading, 
  setLoading, 
  error, 
  setError,
  isFallback,
  setIsFallback
}: { 
  foodItems: FoodItem[], 
  recipes: Recipe[], 
  setRecipes: (r: Recipe[]) => void,
  loading: boolean,
  setLoading: (l: boolean) => void,
  error: string | null,
  setError: (e: string | null) => void,
  isFallback: boolean,
  setIsFallback: (b: boolean) => void
}) {
  const [retryTimer, setRetryTimer] = useState(0);

  const fetchRecipes = async () => {
    if (foodItems.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const ingredientData = foodItems.map(i => ({ name: i.name, category: i.category }));
      const response = await getRecipeRecommendations(ingredientData);
      // Sort by match score descending
      setRecipes(response.recipes.sort((a, b) => b.matchScore - a.matchScore));
      setIsFallback(response.isFallback);
    } catch (e: any) {
      console.error("Recipe fetch error:", e);
      setError(e.message || "Gagal memuat resep.");
      
      // If it's a quota error, set a 60s cooldown
      if (e.message?.includes("Limit AI") || e.message?.includes("kuota")) {
        setRetryTimer(60);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let timer: any;
    if (retryTimer > 0) {
      timer = setInterval(() => {
        setRetryTimer(prev => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [retryTimer]);

  useEffect(() => {
    if (recipes.length === 0 && !error) {
      fetchRecipes();
    }
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Ide Masakan</h2>
          <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">Berdasarkan stok yang Anda miliki.</p>
        </div>
        <button 
          onClick={fetchRecipes}
          disabled={loading || retryTimer > 0}
          className="w-14 h-14 flex flex-col items-center justify-center bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 dark:shadow-none disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 disabled:shadow-none"
        >
          {retryTimer > 0 ? (
            <span className="text-xs font-black">{retryTimer}s</span>
          ) : (
            <ChefHat className={`${loading ? 'animate-bounce' : ''}`} size={24} />
          )}
        </button>
      </div>

      {isFallback && (
        <div className="p-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-[2rem] flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-800 rounded-2xl flex items-center justify-center flex-shrink-0">
            <Info className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h4 className="font-bold text-blue-900 dark:text-blue-200">Mode Offline / Terbatas</h4>
            <p className="text-sm text-blue-700 dark:text-blue-400/80">Kuota AI harian telah habis. Kami menyajikan resep standar untuk sementara waktu.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-[2rem] flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-100 dark:bg-amber-800 rounded-2xl flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h4 className="font-bold text-amber-900 dark:text-amber-200">Informasi AI</h4>
            <p className="text-sm text-amber-700 dark:text-amber-400/80">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white dark:bg-gray-900 p-8 rounded-[2.5rem] border border-gray-100 dark:border-gray-800 animate-pulse space-y-6">
              <div className="h-8 bg-gray-100 dark:bg-gray-800 rounded-xl w-3/4"></div>
              <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded-lg w-1/2"></div>
              <div className="flex gap-2">
                <div className="h-8 bg-gray-50 dark:bg-gray-800 rounded-xl w-20"></div>
                <div className="h-8 bg-gray-50 dark:bg-gray-800 rounded-xl w-24"></div>
              </div>
            </div>
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 p-16 rounded-[2.5rem] border-2 border-dashed border-gray-100 dark:border-gray-800 text-center transition-colors">
          <ChefHat className="w-20 h-20 text-gray-100 dark:text-gray-800 mx-auto mb-6" />
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Belum Ada Resep</h3>
          <p className="text-gray-400 dark:text-gray-500 font-medium">Tambahkan bahan makanan untuk mendapatkan rekomendasi resep cerdas.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {recipes.map((recipe, idx) => (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.1 }}
              key={idx} 
              className="bg-white dark:bg-gray-900 p-8 rounded-[2.5rem] shadow-xl shadow-gray-200/40 dark:shadow-none border border-gray-100 dark:border-gray-800 group hover:border-emerald-500/30 transition-all duration-500"
            >
              <div className="flex items-start justify-between mb-6">
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-gray-900 dark:text-white leading-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{recipe.title}</h3>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest">
                      <Clock size={12} />
                      {recipe.prepTime}
                    </div>
                    <div className={`flex items-center gap-1.5 text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest ${
                      recipe.matchScore > 80 ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 
                      recipe.matchScore > 50 ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                    }`}>
                      Cocok: {recipe.matchScore}%
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-4">Bahan yang Dimiliki</h4>
                    <div className="flex flex-wrap gap-2">
                      {recipe.ingredients.filter(ing => !recipe.missingIngredients.some(m => ing.toLowerCase().includes(m.toLowerCase()))).map((ing, i) => (
                        <span key={i} className="text-xs bg-emerald-50 dark:bg-emerald-900/20 px-4 py-2 rounded-2xl text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-100 dark:border-emerald-900/20 transition-colors">
                          {ing}
                        </span>
                      ))}
                    </div>
                  </div>

                  {recipe.missingIngredients.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-black text-red-400 dark:text-red-500 uppercase tracking-[0.2em] mb-4">Bahan yang Kurang</h4>
                      <div className="flex flex-wrap gap-2">
                        {recipe.missingIngredients.map((ing, i) => (
                          <span key={i} className="text-xs bg-red-50 dark:bg-red-900/20 px-4 py-2 rounded-2xl text-red-700 dark:text-red-400 font-bold border border-red-100 dark:border-red-900/20 transition-colors">
                            {ing}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-100 dark:bg-gray-800 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/40 transition-colors" />
                  <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-4 ml-1">Langkah Memasak</h4>
                  <ol className="space-y-6 relative">
                    {recipe.instructions.map((step, i) => (
                      <li key={i} className="flex gap-6 text-sm text-gray-600 dark:text-gray-300 font-medium leading-relaxed">
                        <div className="w-8 h-8 flex items-center justify-center bg-white dark:bg-gray-900 border-2 border-gray-100 dark:border-gray-800 text-gray-400 dark:text-gray-500 font-black rounded-full flex-shrink-0 group-hover:border-emerald-500 group-hover:text-emerald-600 transition-all z-10">
                          {i + 1}
                        </div>
                        <p className="pt-1">{step}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function HistoryView({ history }: { history: UsageHistory[] }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-8"
    >
      <div>
        <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Riwayat Dapur</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">Catatan penggunaan dan pembuangan bahan makanan.</p>
      </div>

      {history.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 p-16 rounded-[2.5rem] border-2 border-dashed border-gray-100 dark:border-gray-800 text-center transition-colors">
          <History className="w-20 h-20 text-gray-100 dark:text-gray-800 mx-auto mb-6" />
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Belum Ada Riwayat</h3>
          <p className="text-gray-400 dark:text-gray-500 font-medium">Aktivitas dapur Anda akan muncul di sini.</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gray-100 dark:bg-gray-800" />
          <div className="space-y-6">
            {history.map((item, idx) => (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                key={item.id} 
                className="relative flex items-center gap-6 group"
              >
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 z-10 shadow-sm border-4 border-white dark:border-gray-950 transition-transform group-hover:scale-110 ${
                  item.action === "consumed" ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400" : "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
                }`}>
                  {item.action === "consumed" ? <CheckCircle2 size={24} /> : <Trash2 size={24} />}
                </div>
                <div className="flex-1 bg-white dark:bg-gray-900 p-6 rounded-[2rem] shadow-sm border border-gray-100 dark:border-gray-800 group-hover:shadow-md transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-gray-900 dark:text-white">{item.foodName}</h3>
                    <span className="text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-widest">
                      {item.timestamp ? format(item.timestamp.toDate(), "HH:mm") : "..."}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-400 dark:text-gray-500">
                      {item.action === "consumed" ? "Digunakan" : "Dibuang"} • {item.quantity} {item.unit}
                    </p>
                    <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500">
                      {item.timestamp ? format(item.timestamp.toDate(), "dd MMMM yyyy") : "..."}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ProfileView({ user, userProfile }: { user: User, userProfile: UserProfile | null }) {
  const [displayName, setDisplayName] = useState(user.displayName || "");
  const [fullName, setFullName] = useState(userProfile?.fullName || "");
  const [age, setAge] = useState(userProfile?.age?.toString() || "");
  const [origin, setOrigin] = useState(userProfile?.origin || "");
  const [photoURL, setPhotoURL] = useState(user.photoURL || "");
  const [isUpdating, setIsUpdating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error", text: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (userProfile) {
      setFullName(userProfile.fullName || "");
      setAge(userProfile.age?.toString() || "");
      setOrigin(userProfile.origin || "");
    }
  }, [userProfile]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type and size
    if (!file.type.startsWith('image/')) {
      setMessage({ type: "error", text: "File harus berupa gambar." });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: "error", text: "Ukuran gambar maksimal 5MB." });
      return;
    }

    setIsUploading(true);
    setMessage(null);

    const cloudName = (import.meta as any).env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = (import.meta as any).env.VITE_CLOUDINARY_UPLOAD_PRESET;

    if (!cloudName || !uploadPreset) {
      setMessage({ type: "error", text: "Konfigurasi Cloudinary belum lengkap di .env" });
      setIsUploading(false);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', uploadPreset);

    try {
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        { method: 'POST', body: formData }
      );
      const data = await response.json();
      if (data.secure_url) {
        setPhotoURL(data.secure_url);
        setMessage({ type: "success", text: "Gambar berhasil diunggah! Jangan lupa klik Simpan Perubahan." });
      } else {
        throw new Error(data.error?.message || "Gagal mengunggah gambar.");
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      setMessage({ type: "error", text: error.message || "Terjadi kesalahan saat mengunggah." });
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);
    setMessage(null);

    try {
      // Reload user to ensure auth state is fresh
      await user.reload();
      await updateProfile(user, { displayName, photoURL });
      
      // Update Firestore profile
      await updateDoc(doc(db, "users", user.uid), {
        displayName,
        fullName,
        age: Number(age) || 0,
        origin,
        photoURL,
        updatedAt: serverTimestamp()
      });

      setMessage({ type: "success", text: "Profil berhasil diperbarui!" });
    } catch (error: any) {
      console.error("Update profile error:", error);
      if (error.code === "auth/network-request-failed") {
        setMessage({ 
          type: "error", 
          text: "Koneksi gagal. Jika Anda menggunakan mode privat/incognito, silakan coba di jendela biasa atau periksa koneksi internet Anda." 
        });
      } else {
        setMessage({ type: "error", text: "Gagal memperbarui profil. Silakan coba lagi." });
      }
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="max-w-xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Pengaturan Profil</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">Kelola informasi akun Anda di sini.</p>
      </div>

      <div className="bg-white dark:bg-gray-900 p-8 rounded-[2.5rem] shadow-xl shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800 transition-colors">
        <form onSubmit={handleUpdateProfile} className="space-y-8">
          <div className="flex flex-col items-center gap-6 mb-4">
            <div className="relative group">
              <div className="w-32 h-32 rounded-[2.5rem] bg-emerald-50 dark:bg-emerald-900/20 border-4 border-white dark:border-gray-800 shadow-lg overflow-hidden flex items-center justify-center">
                {isUploading ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
                ) : photoURL ? (
                  <img src={photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon size={48} className="text-emerald-200 dark:text-emerald-800" />
                )}
              </div>
              <button 
                type="button"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-2 -right-2 w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center shadow-lg border-4 border-white dark:border-gray-800 hover:scale-110 transition-all disabled:opacity-50"
              >
                <Camera size={18} />
              </button>
              <input 
                ref={fileInputRef}
                type="file" 
                accept="image/*" 
                className="hidden" 
                onChange={handleImageUpload}
              />
            </div>
            <div className="text-center">
              <h3 className="font-bold text-gray-900 dark:text-white">{user.email}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-widest mt-1">ID Pengguna: {user.uid.slice(0, 8)}...</p>
            </div>
          </div>

          {message && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-4 rounded-2xl text-sm font-bold flex items-center gap-3 ${
                message.type === "success" ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/40" : "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/40"
              }`}
            >
              {message.type === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              {message.text}
            </motion.div>
          )}

          <div className="space-y-6">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Nama Tampilan</label>
              <input 
                required
                type="text" 
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Nama Anda"
                className="w-full px-6 py-5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent rounded-[1.5rem] focus:bg-white dark:focus:bg-gray-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
              />
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Nama Lengkap</label>
              <input 
                type="text" 
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Nama Lengkap Anda"
                className="w-full px-6 py-5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent rounded-[1.5rem] focus:bg-white dark:focus:bg-gray-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Umur</label>
                <input 
                  type="number" 
                  value={age}
                  onChange={e => setAge(e.target.value)}
                  placeholder="0"
                  className="w-full px-6 py-5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent rounded-[1.5rem] focus:bg-white dark:focus:bg-gray-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white no-spinner placeholder:text-gray-300 dark:placeholder:text-gray-600"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">Asal</label>
                <input 
                  type="text" 
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  placeholder="Kota Asal"
                  className="w-full px-6 py-5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent rounded-[1.5rem] focus:bg-white dark:focus:bg-gray-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] ml-1">URL Foto Profil</label>
              <input 
                type="url" 
                value={photoURL}
                onChange={e => setPhotoURL(e.target.value)}
                placeholder="https://contoh.com/foto.jpg"
                className="w-full px-6 py-5 bg-gray-50 dark:bg-gray-800 border-2 border-transparent rounded-[1.5rem] focus:bg-white dark:focus:bg-gray-900 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600"
              />
              <p className="text-[10px] text-gray-400 dark:text-gray-500 font-medium ml-1">Gunakan URL gambar publik untuk memperbarui foto profil Anda.</p>
            </div>
          </div>

          <button 
            disabled={isUpdating}
            type="submit"
            className="w-full py-5 bg-emerald-600 text-white rounded-[1.5rem] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 dark:shadow-none disabled:opacity-50 flex items-center justify-center gap-3"
          >
            {isUpdating ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              "Perbarui Profil"
            )}
          </button>
        </form>
      </div>
    </motion.div>
  );
}
