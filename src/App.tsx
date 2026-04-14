import React, { useState, useEffect } from "react";
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
  Camera
} from "lucide-react";
import { format, differenceInDays, isPast, isToday, addDays } from "date-fns";
import { getRecipeRecommendations, Recipe } from "./services/geminiService";

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
      <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
        <div className="bg-white p-6 rounded-2xl shadow-xl max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Terjadi Kesalahan</h2>
          <p className="text-gray-600 mb-4">{errorInfo || "Maaf, ada masalah saat memproses data."}</p>
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
    setLoginError(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.code === "auth/popup-closed-by-user") {
        setLoginError("Proses masuk dibatalkan. Silakan coba lagi.");
      } else if (error.code === "auth/popup-blocked") {
        setLoginError("Popup diblokir oleh browser. Silakan izinkan popup untuk masuk.");
      } else {
        setLoginError("Gagal masuk. Silakan periksa koneksi internet Anda.");
      }
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
      <div className="min-h-screen flex items-center justify-center bg-emerald-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
          className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full shadow-lg shadow-emerald-100"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-white flex flex-col lg:flex-row overflow-hidden">
        {/* Left Side - Visual Branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-emerald-600 relative items-center justify-center p-12 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.15)_0%,transparent_50%)]" />
          <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-emerald-500 rounded-full blur-3xl opacity-50" />
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-emerald-700 rounded-full blur-3xl opacity-50" />
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 text-white max-w-lg"
          >
            <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-8 border border-white/30">
              <Utensils className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-7xl font-extrabold mb-6 leading-[0.9] tracking-tighter">
              Dapur<br/><span className="text-emerald-200">Pintar.</span>
            </h1>
            <p className="text-xl text-emerald-50/80 font-medium leading-relaxed">
              Solusi cerdas manajemen stok makanan rumah tangga. Kurangi limbah, hemat biaya, dan temukan resep lezat setiap hari.
            </p>
            
            <div className="mt-12 flex gap-8">
              <div className="space-y-1">
                <div className="text-3xl font-bold">100%</div>
                <div className="text-sm text-emerald-100/60 uppercase tracking-widest font-bold">Cerdas</div>
              </div>
              <div className="space-y-1">
                <div className="text-3xl font-bold">0%</div>
                <div className="text-sm text-emerald-100/60 uppercase tracking-widest font-bold">Limbah</div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Right Side - Login Form */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 lg:p-24 bg-gray-50/50">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md"
          >
            <div className="lg:hidden flex items-center gap-3 mb-12">
              <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center">
                <Utensils className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">DapurPintar</h1>
            </div>

            <div className="mb-10">
              <h2 className="text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
                {authMode === "google" 
                  ? "Selamat Datang" 
                  : (showForgotPassword 
                      ? "Lupa Kata Sandi?" 
                      : (isSignUp ? "Buat Akun" : "Masuk Kembali"))}
              </h2>
              <p className="text-gray-500 font-medium">
                {authMode === "google" 
                  ? "Masuk untuk mulai mengelola dapur Anda dengan lebih baik." 
                  : (showForgotPassword 
                      ? "Masukkan email Anda untuk menerima tautan reset." 
                      : (isSignUp ? "Lengkapi detail di bawah untuk mendaftar." : "Masukkan email dan kata sandi Anda."))}
              </p>
            </div>

            {loginError && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8 p-4 bg-red-50 text-red-600 text-sm rounded-2xl border border-red-100 flex items-center gap-3"
              >
                <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <span className="font-medium">{loginError}</span>
              </motion.div>
            )}

            <AnimatePresence mode="wait">
              {authMode === "google" ? (
                <motion.div
                  key="google-mode"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <button 
                    onClick={handleLogin}
                    className="w-full flex items-center justify-center gap-4 py-5 bg-white text-gray-700 rounded-2xl font-bold hover:bg-gray-50 transition-all border-2 border-gray-100 shadow-sm group"
                  >
                    <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
                    <span>Lanjutkan dengan Google</span>
                    <ChevronRight className="w-5 h-5 text-gray-300 group-hover:translate-x-1 transition-transform" />
                  </button>

                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-gray-50 px-4 text-gray-400 font-bold tracking-widest">Atau</span></div>
                  </div>

                  <button 
                    onClick={() => setAuthMode("email")}
                    className="w-full py-5 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-lg shadow-gray-200"
                  >
                    Gunakan Email & Password
                  </button>
                </motion.div>
              ) : (
                <motion.form
                  key="email-mode"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  onSubmit={handleEmailAuth}
                  className="space-y-4"
                >
                  {resetSent ? (
                    <div className="p-6 bg-emerald-50 border border-emerald-100 rounded-2xl text-center space-y-4">
                      <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                        <CheckCircle2 className="text-emerald-600" />
                      </div>
                      <h3 className="font-bold text-emerald-900">Email Terkirim!</h3>
                      <p className="text-sm text-emerald-700">Silakan periksa kotak masuk Anda untuk instruksi reset kata sandi.</p>
                      <button 
                        type="button"
                        onClick={() => {
                          setShowForgotPassword(false);
                          setResetSent(false);
                        }}
                        className="text-sm font-bold text-emerald-600 hover:underline"
                      >
                        Kembali ke Login
                      </button>
                    </div>
                  ) : (
                    <>
                      {isSignUp && !showForgotPassword && (
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nama Lengkap</label>
                          <input 
                            required
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-6 py-4 bg-white border-2 border-gray-100 rounded-2xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900"
                            placeholder="Nama Anda"
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Email</label>
                        <input 
                          required
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full px-6 py-4 bg-white border-2 border-gray-100 rounded-2xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900"
                          placeholder="email@contoh.com"
                        />
                      </div>
                      {!showForgotPassword && (
                        <div className="space-y-2">
                          <div className="flex justify-between items-center ml-1">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Kata Sandi</label>
                            {!isSignUp && (
                              <button 
                                type="button"
                                onClick={() => setShowForgotPassword(true)}
                                className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest"
                              >
                                Lupa?
                              </button>
                            )}
                          </div>
                          <input 
                            required
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-6 py-4 bg-white border-2 border-gray-100 rounded-2xl focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900"
                            placeholder="••••••••"
                          />
                        </div>
                      )}

                      <button 
                        disabled={isAuthSubmitting}
                        type="submit"
                        className="w-full py-5 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 flex items-center justify-center gap-3"
                      >
                        {isAuthSubmitting ? (
                          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
                        ) : (
                          <span>
                            {showForgotPassword 
                              ? "Kirim Tautan Reset" 
                              : (isSignUp ? "Daftar Sekarang" : "Masuk")}
                          </span>
                        )}
                      </button>

                      <div className="flex flex-col gap-3 pt-4">
                        {!showForgotPassword ? (
                          <button 
                            type="button"
                            onClick={() => setIsSignUp(!isSignUp)}
                            className="text-sm font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
                          >
                            {isSignUp ? "Sudah punya akun? Masuk" : "Belum punya akun? Daftar"}
                          </button>
                        ) : (
                          <button 
                            type="button"
                            onClick={() => setShowForgotPassword(false)}
                            className="text-sm font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
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
                          className="text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          Kembali ke Pilihan Lain
                        </button>
                      </div>
                    </>
                  )}
                </motion.form>
              )}
            </AnimatePresence>

            <p className="mt-12 text-center text-sm text-gray-400 font-medium">
              Dengan masuk, Anda menyetujui Ketentuan Layanan dan Kebijakan Privasi kami.
            </p>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F8FAFC] pb-32">
        {/* Modern Header */}
        <header className="bg-white/80 backdrop-blur-xl px-6 py-5 flex items-center justify-between sticky top-0 z-40 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-100">
              <Utensils className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 leading-none mb-1">DapurPintar</h1>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sistem Aktif</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs font-bold text-gray-900">{user.displayName || "Pengguna"}</span>
              <span className="text-[10px] text-gray-400 font-medium">{user.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setActiveTab("profile")}
                className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${activeTab === "profile" ? "bg-emerald-50 text-emerald-600" : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50"}`}
                title="Edit Profil"
              >
                <UserIcon className="w-5 h-5" />
              </button>
              <button 
                onClick={handleLogout}
                className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
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
              <RecipeRecommendations key="recipes" foodItems={foodItems} />
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
      await updateDoc(doc(db, "foodItems", item.id), { status: action });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `foodItems/${item.id}`);
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
          <h2 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">Peringatan Penting</h2>
          <div className="grid gap-3">
            {expired.map(item => (
              <motion.div 
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                key={item.id} 
                className="bg-red-50/50 border border-red-100 p-4 rounded-3xl flex items-center gap-4 group"
              >
                <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-red-900">{item.name}</h3>
                  <p className="text-xs text-red-600 font-medium">Sudah kedaluwarsa sejak {item.expiryDate ? format(item.expiryDate.toDate(), "dd MMM") : "..."}</p>
                </div>
                <button 
                  onClick={() => handleAction(item, "discarded")} 
                  className="w-10 h-10 flex items-center justify-center bg-white text-red-400 hover:text-red-600 rounded-xl shadow-sm transition-all"
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
                className="bg-amber-50/50 border border-amber-100 p-4 rounded-3xl flex items-center gap-4"
              >
                <div className="w-12 h-12 bg-amber-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                  <Clock className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-amber-900">{item.name}</h3>
                  <p className="text-xs text-amber-600 font-medium">Kedaluwarsa dalam {item.expiryDate ? differenceInDays(item.expiryDate.toDate(), new Date()) : "..."} hari</p>
                </div>
                <button 
                  onClick={() => handleAction(item, "consumed")} 
                  className="w-10 h-10 flex items-center justify-center bg-white text-emerald-600 hover:bg-emerald-50 rounded-xl shadow-sm transition-all"
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
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight">Inventaris Dapur</h2>
            <p className="text-sm text-gray-400 font-medium">Kelola semua stok makanan Anda di sini.</p>
          </div>
          <div className="flex gap-2">
            <button className="p-3 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-emerald-600 transition-colors shadow-sm">
              <Search size={20} />
            </button>
          </div>
        </div>

        {foodItems.length === 0 ? (
          <div className="bg-white p-16 rounded-[2.5rem] border-2 border-dashed border-gray-100 text-center">
            <div className="w-20 h-20 bg-gray-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <Plus className="w-10 h-10 text-gray-200" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Dapur Masih Kosong</h3>
            <p className="text-gray-400 font-medium mb-8">Mulai tambahkan stok makanan Anda untuk mendapatkan pengingat cerdas.</p>
            <button 
              onClick={() => setActiveTab("add")}
              className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100"
            >
              Tambah Sekarang
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {foodItems.map((item, idx) => (
              <motion.div 
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
                key={item.id} 
                className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 flex items-center gap-5 group hover:shadow-xl hover:shadow-gray-200/50 transition-all duration-300"
              >
                <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-50 transition-colors duration-300">
                  <Utensils className="w-7 h-7 text-gray-300 group-hover:text-emerald-600 transition-colors duration-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-gray-900 truncate">{item.name}</h3>
                    <span className="px-2 py-0.5 bg-gray-100 text-[9px] font-black text-gray-400 uppercase tracking-widest rounded-md">
                      {item.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                      {item.quantity} {item.unit}
                    </div>
                    <div className="flex items-center gap-1 text-xs font-bold text-gray-400">
                      <Calendar size={12} />
                      {item.expiryDate ? format(item.expiryDate.toDate(), "dd MMM") : "..."}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleAction(item, "consumed")}
                      className="w-9 h-9 flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 rounded-xl transition-all"
                      title="Tandai sudah dikonsumsi"
                    >
                      <CheckCircle2 size={18} />
                    </button>
                    <button 
                      onClick={() => onEdit(item)}
                      className="w-9 h-9 flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-blue-50 hover:text-blue-600 rounded-xl transition-all"
                      title="Edit bahan"
                    >
                      <Edit2 size={16} />
                    </button>
                  </div>
                  <button 
                    onClick={() => handleAction(item, "discarded")}
                    className="w-9 h-9 flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 rounded-xl transition-all w-full"
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
    <div className="bg-white p-5 rounded-[2rem] border border-gray-100 shadow-sm">
      <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center mb-4`}>
        {React.cloneElement(icon as React.ReactElement<any>, { size: 20 })}
      </div>
      <div className="text-2xl font-black text-gray-900 mb-0.5">{value}</div>
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</div>
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
      className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-gray-200/50 border border-gray-100 max-w-xl mx-auto"
    >
      <div className="flex items-center gap-4 mb-10">
        <button onClick={onComplete} className="w-12 h-12 flex items-center justify-center bg-gray-50 hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 rounded-2xl transition-all">
          <ArrowLeft size={24} />
        </button>
        <div>
          <h2 className="text-2xl font-black text-gray-900 tracking-tight">
            {editingItem ? "Edit Stok" : "Tambah Stok"}
          </h2>
          <p className="text-sm text-gray-400 font-medium">
            {editingItem ? "Perbarui detail bahan makanan Anda." : "Masukkan detail bahan makanan baru."}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="space-y-3">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nama Makanan</label>
          <input 
            required
            type="text" 
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Contoh: Telur Ayam Kampung"
            className="w-full px-6 py-5 bg-gray-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 placeholder:text-gray-300"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Jumlah & Satuan</label>
            <div className="flex items-center bg-gray-50 rounded-[1.5rem] border-2 border-transparent focus-within:bg-white focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/10 transition-all">
              <input 
                type="number" 
                step="0.1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="0"
                className="w-full px-6 py-5 bg-transparent border-none focus:ring-0 font-bold text-gray-900 no-spinner"
              />
              <select 
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="bg-emerald-50 border-none focus:ring-0 text-xs font-black text-emerald-600 px-4 py-2 rounded-xl mr-3"
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
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Kategori</label>
            <select 
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-6 py-5 bg-gray-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900"
            >
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Tanggal Kedaluwarsa</label>
          <div className="relative group">
            <Calendar className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300 group-focus-within:text-emerald-500 transition-colors" />
            <input 
              required
              type="date" 
              value={expiryDate}
              onChange={e => setExpiryDate(e.target.value)}
              className="w-full pl-16 pr-6 py-5 bg-gray-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900"
            />
          </div>
        </div>

        <button 
          disabled={isSubmitting}
          type="submit"
          className="w-full py-5 bg-emerald-600 text-white rounded-[1.5rem] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 disabled:opacity-50 flex items-center justify-center gap-3"
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

function RecipeRecommendations({ foodItems }: { foodItems: FoodItem[] }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRecipes = async () => {
    if (foodItems.length === 0) return;
    setLoading(true);
    try {
      const ingredientData = foodItems.map(i => ({ name: i.name, category: i.category }));
      const recs = await getRecipeRecommendations(ingredientData);
      // Sort by match score descending
      setRecipes(recs.sort((a, b) => b.matchScore - a.matchScore));
    } catch (e) {
      console.error("Recipe fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipes();
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
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">Ide Masakan</h2>
          <p className="text-sm text-gray-400 font-medium">Berdasarkan stok yang Anda miliki.</p>
        </div>
        <button 
          onClick={fetchRecipes}
          disabled={loading}
          className="w-14 h-14 flex items-center justify-center bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50"
        >
          <ChefHat className={`${loading ? 'animate-bounce' : ''}`} size={24} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-gray-100 animate-pulse space-y-6">
              <div className="h-8 bg-gray-100 rounded-xl w-3/4"></div>
              <div className="h-4 bg-gray-100 rounded-lg w-1/2"></div>
              <div className="flex gap-2">
                <div className="h-8 bg-gray-50 rounded-xl w-20"></div>
                <div className="h-8 bg-gray-50 rounded-xl w-24"></div>
              </div>
            </div>
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <div className="bg-white p-16 rounded-[2.5rem] border-2 border-dashed border-gray-100 text-center">
          <ChefHat className="w-20 h-20 text-gray-100 mx-auto mb-6" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Belum Ada Resep</h3>
          <p className="text-gray-400 font-medium">Tambahkan bahan makanan untuk mendapatkan rekomendasi resep cerdas.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {recipes.map((recipe, idx) => (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.1 }}
              key={idx} 
              className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-gray-200/40 border border-gray-100 group hover:border-emerald-500/30 transition-all duration-500"
            >
              <div className="flex items-start justify-between mb-6">
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-gray-900 leading-tight group-hover:text-emerald-600 transition-colors">{recipe.title}</h3>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-600 text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest">
                      <Clock size={12} />
                      {recipe.prepTime}
                    </div>
                    <div className={`flex items-center gap-1.5 text-[10px] font-black px-3 py-1.5 rounded-xl uppercase tracking-widest ${
                      recipe.matchScore > 80 ? 'bg-emerald-100 text-emerald-700' : 
                      recipe.matchScore > 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                    }`}>
                      Cocok: {recipe.matchScore}%
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div>
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Bahan yang Dimiliki</h4>
                    <div className="flex flex-wrap gap-2">
                      {recipe.ingredients.filter(ing => !recipe.missingIngredients.some(m => ing.toLowerCase().includes(m.toLowerCase()))).map((ing, i) => (
                        <span key={i} className="text-xs bg-emerald-50 px-4 py-2 rounded-2xl text-emerald-700 font-bold border border-emerald-100 transition-colors">
                          {ing}
                        </span>
                      ))}
                    </div>
                  </div>

                  {recipe.missingIngredients.length > 0 && (
                    <div>
                      <h4 className="text-[10px] font-black text-red-400 uppercase tracking-[0.2em] mb-4">Bahan yang Kurang</h4>
                      <div className="flex flex-wrap gap-2">
                        {recipe.missingIngredients.map((ing, i) => (
                          <span key={i} className="text-xs bg-red-50 px-4 py-2 rounded-2xl text-red-700 font-bold border border-red-100 transition-colors">
                            {ing}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-100 group-hover:bg-emerald-100 transition-colors" />
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4 ml-1">Langkah Memasak</h4>
                  <ol className="space-y-6 relative">
                    {recipe.instructions.map((step, i) => (
                      <li key={i} className="flex gap-6 text-sm text-gray-600 font-medium leading-relaxed">
                        <div className="w-8 h-8 flex items-center justify-center bg-white border-2 border-gray-100 text-gray-400 font-black rounded-full flex-shrink-0 group-hover:border-emerald-500 group-hover:text-emerald-600 transition-all z-10">
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
        <h2 className="text-3xl font-black text-gray-900 tracking-tight">Riwayat Dapur</h2>
        <p className="text-sm text-gray-400 font-medium">Catatan penggunaan dan pembuangan bahan makanan.</p>
      </div>

      {history.length === 0 ? (
        <div className="bg-white p-16 rounded-[2.5rem] border-2 border-dashed border-gray-100 text-center">
          <History className="w-20 h-20 text-gray-100 mx-auto mb-6" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Belum Ada Riwayat</h3>
          <p className="text-gray-400 font-medium">Aktivitas dapur Anda akan muncul di sini.</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gray-100" />
          <div className="space-y-6">
            {history.map((item, idx) => (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                key={item.id} 
                className="relative flex items-center gap-6 group"
              >
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 z-10 shadow-sm border-4 border-white transition-transform group-hover:scale-110 ${
                  item.action === "consumed" ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                }`}>
                  {item.action === "consumed" ? <CheckCircle2 size={24} /> : <Trash2 size={24} />}
                </div>
                <div className="flex-1 bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 group-hover:shadow-md transition-all">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-gray-900">{item.foodName}</h3>
                    <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">
                      {item.timestamp ? format(item.timestamp.toDate(), "HH:mm") : "..."}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-400">
                      {item.action === "consumed" ? "Digunakan" : "Dibuang"} • {item.quantity} {item.unit}
                    </p>
                    <p className="text-[10px] font-bold text-gray-400">
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
  const [message, setMessage] = useState<{ type: "success" | "error", text: string } | null>(null);

  useEffect(() => {
    if (userProfile) {
      setFullName(userProfile.fullName || "");
      setAge(userProfile.age?.toString() || "");
      setOrigin(userProfile.origin || "");
    }
  }, [userProfile]);

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
        <h2 className="text-3xl font-black text-gray-900 tracking-tight">Pengaturan Profil</h2>
        <p className="text-sm text-gray-400 font-medium">Kelola informasi akun Anda di sini.</p>
      </div>

      <div className="bg-white p-8 rounded-[2.5rem] shadow-xl shadow-gray-200/50 border border-gray-100">
        <form onSubmit={handleUpdateProfile} className="space-y-8">
          <div className="flex flex-col items-center gap-6 mb-4">
            <div className="relative group">
              <div className="w-32 h-32 rounded-[2.5rem] bg-emerald-50 border-4 border-white shadow-lg overflow-hidden flex items-center justify-center">
                {photoURL ? (
                  <img src={photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon size={48} className="text-emerald-200" />
                )}
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center shadow-lg border-4 border-white">
                <Camera size={18} />
              </div>
            </div>
            <div className="text-center">
              <h3 className="font-bold text-gray-900">{user.email}</h3>
              <p className="text-xs text-gray-400 font-medium uppercase tracking-widest mt-1">ID Pengguna: {user.uid.slice(0, 8)}...</p>
            </div>
          </div>

          {message && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-4 rounded-2xl text-sm font-bold flex items-center gap-3 ${
                message.type === "success" ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-red-50 text-red-600 border border-red-100"
              }`}
            >
              {message.type === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              {message.text}
            </motion.div>
          )}

          <div className="space-y-6">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nama Tampilan</label>
              <input 
                required
                type="text" 
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Nama Anda"
                className="w-full px-6 py-5 bg-gray-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900"
              />
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nama Lengkap</label>
              <input 
                type="text" 
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Nama Lengkap Anda"
                className="w-full px-6 py-5 bg-gray-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Umur</label>
                <input 
                  type="number" 
                  value={age}
                  onChange={e => setAge(e.target.value)}
                  placeholder="0"
                  className="w-full px-6 py-5 bg-gray-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900 no-spinner"
                />
              </div>
              <div className="space-y-3">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Asal</label>
                <input 
                  type="text" 
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  placeholder="Kota Asal"
                  className="w-full px-6 py-5 bg-gray-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900"
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">URL Foto Profil</label>
              <input 
                type="url" 
                value={photoURL}
                onChange={e => setPhotoURL(e.target.value)}
                placeholder="https://contoh.com/foto.jpg"
                className="w-full px-6 py-5 bg-gray-50 border-2 border-transparent rounded-[1.5rem] focus:bg-white focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-bold text-gray-900"
              />
              <p className="text-[10px] text-gray-400 font-medium ml-1">Gunakan URL gambar publik untuk memperbarui foto profil Anda.</p>
            </div>
          </div>

          <button 
            disabled={isUpdating}
            type="submit"
            className="w-full py-5 bg-emerald-600 text-white rounded-[1.5rem] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 disabled:opacity-50 flex items-center justify-center gap-3"
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
