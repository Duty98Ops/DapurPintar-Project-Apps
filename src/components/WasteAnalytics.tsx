import React from "react";
import { motion } from "motion/react";
import { 
  BarChart as ReBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as ReTooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart as RePieChart,
  Pie,
  Cell
} from 'recharts';
import { Leaf, Trash2, CheckCircle2, TrendingDown, AlertTriangle, Zap, Info } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths, isSameMonth } from "date-fns";

interface UsageHistory {
  id: string;
  userId: string;
  foodName: string;
  action: "consumed" | "discarded";
  quantity: number;
  unit: string;
  timestamp: any;
}

export default function WasteAnalytics({ history, isDarkMode }: { history: UsageHistory[], isDarkMode: boolean }) {
  const consumedCount = history.filter(h => h.action === "consumed").length;
  const discardedCount = history.filter(h => h.action === "discarded").length;
  const totalCount = consumedCount + discardedCount;
  
  const sustainabilityScore = totalCount === 0 ? 100 : Math.round((consumedCount / totalCount) * 100);
  
  const pieData = [
    { name: 'Digunakan', value: consumedCount, color: '#10b981' },
    { name: 'Terbuang', value: discardedCount, color: '#ef4444' },
  ];

  // Colors for dark mode adjustment
  const gridColor = isDarkMode ? "rgba(255,255,255,0.05)" : "#f3f4f6";
  const axisColor = isDarkMode ? "#4b5563" : "#9ca3af";
  const tooltipBg = isDarkMode ? "#1f2937" : "#ffffff";
  const tooltipCursor = isDarkMode ? "rgba(255,255,255,0.05)" : "#f9fafb";
  const tooltipBorder = isDarkMode ? "#374151" : "none";
  const tooltipText = isDarkMode ? "#f9fafb" : "#111827";

  // Last 6 months trend
  const last6Months = eachMonthOfInterval({
    start: subMonths(new Date(), 5),
    end: new Date()
  });

  const trendData = last6Months.map(month => {
    const monthStart = startOfMonth(month);
    const monthEnd = endOfMonth(month);
    
    const monthUsage = history.filter(h => {
      const date = h.timestamp?.toDate();
      return date && date >= monthStart && date <= monthEnd;
    });

    return {
      name: format(month, 'MMM'),
      consumed: monthUsage.filter(h => h.action === "consumed").length,
      discarded: monthUsage.filter(h => h.action === "discarded").length,
    };
  });

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-500";
    if (score >= 50) return "text-amber-500";
    return "text-red-500";
  };

  const getScoreMessage = (score: number) => {
    if (score >= 90) return "Luar biasa! Anda sangat efisien dalam mengelola makanan.";
    if (score >= 70) return "Bagus! Terus pertahankan kebiasaan hemat Anda.";
    if (score >= 50) return "Cukup baik, tapi masih ada ruang untuk perbaikan.";
    return "Waspada! Banyak makanan terbuang. Coba rencanakan belanja Anda lebih baik.";
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-24"
    >
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">Waste Analytics</h2>
          <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">Pantau jejak keberlanjutan dapur Anda.</p>
        </div>
        <div className="w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-600">
          <Zap size={28} />
        </div>
      </header>

      {/* Sustainability Score Card */}
      <div className="bg-white dark:bg-gray-900 p-8 rounded-[2.5rem] border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden relative group">
        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
          <Leaf size={120} />
        </div>
        
        <div className="relative z-10">
          <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-6 flex items-center gap-2">
            <Leaf size={14} /> Sustainability Score
          </h3>
          
          <div className="flex items-end gap-3 mb-4">
            <span className={`text-7xl font-black tracking-tighter ${getScoreColor(sustainabilityScore)}`}>
              {sustainabilityScore}
            </span>
            <span className="text-xl font-bold text-gray-300 dark:text-gray-700 mb-2">/ 100</span>
          </div>
          
          <p className="text-gray-600 dark:text-gray-400 font-medium text-lg leading-relaxed max-w-md">
            {getScoreMessage(sustainabilityScore)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Composition Chart */}
        <div className="bg-white dark:bg-gray-900 p-6 rounded-[2rem] border border-gray-100 dark:border-gray-800">
          <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-6">Komposisi Penggunaan</h3>
          <div className="h-64 flex items-center justify-center">
            {totalCount > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={8}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <ReTooltip 
                    contentStyle={{ 
                      borderRadius: '16px', 
                      backgroundColor: tooltipBg, 
                      border: `1px solid ${tooltipBorder}`,
                      boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                      color: tooltipText
                    }}
                    itemStyle={{ color: tooltipText }}
                  />
                  <Legend verticalAlign="bottom" height={36}/>
                </RePieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center">
                <Info size={40} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400 font-medium">Belum ada data riwayat.</p>
              </div>
            )}
          </div>
        </div>

        {/* Comparison Stats */}
        <div className="grid gap-4">
          <div className="bg-emerald-50 dark:bg-emerald-900/10 p-6 rounded-[2rem] border border-emerald-100 dark:border-emerald-900/20 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-2">
              <CheckCircle2 className="text-emerald-500" size={20} />
              <span className="text-xs font-black text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-widest">Digunakan</span>
            </div>
            <div className="text-3xl font-black text-emerald-700 dark:text-emerald-400">{consumedCount} <span className="text-sm font-bold opacity-50">Item</span></div>
          </div>
          
          <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-[2rem] border border-red-100 dark:border-red-900/20 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-2">
              <Trash2 className="text-red-500" size={20} />
              <span className="text-xs font-black text-red-600/70 dark:text-red-400/70 uppercase tracking-widest">Terbuang</span>
            </div>
            <div className="text-3xl font-black text-red-700 dark:text-red-400">{discardedCount} <span className="text-sm font-bold opacity-50">Item</span></div>
          </div>
        </div>
      </div>

      {/* Trend Chart */}
      <div className="bg-white dark:bg-gray-900 p-8 rounded-[2.5rem] border border-gray-100 dark:border-gray-800 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xs font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Tren 6 Bulan Terakhir</h3>
          <div className="flex items-center gap-4">
             <div className="flex items-center gap-2">
               <div className="w-3 h-3 rounded-full bg-emerald-500" />
               <span className="text-[10px] font-bold text-gray-400 uppercase">Hemat</span>
             </div>
             <div className="flex items-center gap-2">
               <div className="w-3 h-3 rounded-full bg-red-500" />
               <span className="text-[10px] font-bold text-gray-400 uppercase">Limbah</span>
             </div>
          </div>
        </div>
        
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ReBarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 700, fill: axisColor }}
                dy={10}
              />
              <YAxis 
                hide 
              />
              <ReTooltip 
                cursor={{ fill: tooltipCursor }}
                contentStyle={{ 
                  borderRadius: '16px', 
                  backgroundColor: tooltipBg, 
                  border: `1px solid ${tooltipBorder}`,
                  boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                  color: tooltipText
                }}
                itemStyle={{ color: tooltipText }}
              />
              <Bar dataKey="consumed" fill="#10b981" radius={[6, 6, 0, 0]} barSize={20} />
              <Bar dataKey="discarded" fill="#ef4444" radius={[6, 6, 0, 0]} barSize={20} />
            </ReBarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sustainability Tips */}
      <div className="bg-emerald-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-emerald-500/20">
         <div className="flex items-center gap-3 mb-4">
           <Zap size={24} />
           <h3 className="text-lg font-black uppercase tracking-tight">Tips Hemat & Berkelanjutan</h3>
         </div>
         <ul className="space-y-4">
           <li className="flex gap-4 items-start">
             <div className="w-6 h-6 rounded-full bg-white/20 flex-shrink-0 flex items-center justify-center font-bold text-xs">1</div>
             <p className="text-sm font-medium opacity-90 leading-relaxed">Gunakan fitur "Rekomendasi Resep" untuk menghabiskan bahan yang hampir kedaluwarsa.</p>
           </li>
           <li className="flex gap-4 items-start">
             <div className="w-6 h-6 rounded-full bg-white/20 flex-shrink-0 flex items-center justify-center font-bold text-xs">2</div>
             <p className="text-sm font-medium opacity-90 leading-relaxed">Aktifkan pengingat email agar Anda mendapatkan notifikasi 3 hari sebelum bahan basi.</p>
           </li>
           <li className="flex gap-4 items-start">
             <div className="w-6 h-6 rounded-full bg-white/20 flex-shrink-0 flex items-center justify-center font-bold text-xs">3</div>
             <p className="text-sm font-medium opacity-90 leading-relaxed">Beli bahan makanan sesuai porsi mingguan untuk menghindari penumpukan yang tidak perlu.</p>
           </li>
         </ul>
      </div>
    </motion.div>
  );
}
