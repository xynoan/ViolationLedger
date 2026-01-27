import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { MainLayout } from "@/components/layout/MainLayout";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Vehicles from "./pages/Vehicles";
import Hosts from "./pages/Hosts";
import Cameras from "./pages/Cameras";
import Warnings from "./pages/Warnings";
import Tickets from "./pages/Tickets";
import ViolationsHistory from "./pages/ViolationsHistory";
import UploadImage from "./pages/UploadImage";
import Settings from "./pages/Settings";
import Analytics from "./pages/Analytics";
import UserManagement from "./pages/UserManagement";
import AuditLogs from "./pages/AuditLogs";
import NotFound from "./pages/NotFound";
import { ProtectedRoute } from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <MainLayout>
                    <Routes>
                      <Route path="/" element={<Index />} />
                      <Route path="/vehicles" element={<Vehicles />} />
                      <Route path="/hosts" element={<Hosts />} />
                      <Route path="/cameras" element={<Cameras />} />
                      <Route path="/warnings" element={<Warnings />} />
                      <Route path="/tickets" element={<Tickets />} />
                      <Route path="/violations" element={<ViolationsHistory />} />
                      <Route path="/upload" element={<UploadImage />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/analytics" element={<Analytics />} />
                      <Route path="/users" element={<UserManagement />} />
                      <Route path="/audit-logs" element={<AuditLogs />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </MainLayout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
