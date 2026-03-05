import { Navigate } from 'react-router-dom';
import Dashboard from './Dashboard';
import { useAuth } from '@/hooks/useAuth';

const Index = () => {
  const { user } = useAuth();
  if (user?.role === 'encoder') {
    return <Navigate to="/vehicles" replace />;
  }
  return <Dashboard />;
};

export default Index;
