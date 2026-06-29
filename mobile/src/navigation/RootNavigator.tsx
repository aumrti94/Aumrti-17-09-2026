import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useAuth } from '@/contexts/AuthContext';
import LoginScreen from '@/screens/auth/LoginScreen';

// Doctor screens
import WardRoundsScreen from '@/screens/doctor/WardRoundsScreen';
import PrescriptionScreen from '@/screens/doctor/PrescriptionScreen';
import LabResultsScreen from '@/screens/doctor/LabResultsScreen';

// Nurse screens
import VitalsEntryScreen from '@/screens/nurse/VitalsEntryScreen';
import MARScreen from '@/screens/nurse/MARScreen';

// Patient screens
import AppointmentsScreen from '@/screens/patient/AppointmentsScreen';
import BillsScreen from '@/screens/patient/BillsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TEAL = '#0E7B7B';
const NAVY = '#1A2F5A';

function DoctorTabs() {
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: NAVY, headerShown: false }}>
      <Tab.Screen
        name="WardRounds"
        component={WardRoundsScreen}
        options={{ title: 'Ward Rounds', tabBarIcon: ({ color }) => <Text style={{ fontSize: 18 }}>🏥</Text> }}
      />
      <Tab.Screen
        name="Prescriptions"
        component={PrescriptionScreen}
        options={{ title: 'Prescribe', tabBarIcon: ({ color }) => <Text style={{ fontSize: 18 }}>💊</Text> }}
      />
      <Tab.Screen
        name="LabResults"
        component={LabResultsScreen}
        options={{ title: 'Lab Results', tabBarIcon: ({ color }) => <Text style={{ fontSize: 18 }}>🔬</Text> }}
      />
    </Tab.Navigator>
  );
}

function NurseTabs() {
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: TEAL, headerShown: false }}>
      <Tab.Screen
        name="Vitals"
        component={VitalsEntryScreen}
        options={{ title: 'Vitals', tabBarIcon: () => <Text style={{ fontSize: 18 }}>❤️</Text> }}
      />
      <Tab.Screen
        name="MAR"
        component={MARScreen}
        options={{ title: 'Medications', tabBarIcon: () => <Text style={{ fontSize: 18 }}>💉</Text> }}
      />
    </Tab.Navigator>
  );
}

function PatientTabs() {
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: NAVY, headerShown: false }}>
      <Tab.Screen
        name="Appointments"
        component={AppointmentsScreen}
        options={{ title: 'Appointments', tabBarIcon: () => <Text style={{ fontSize: 18 }}>📅</Text> }}
      />
      <Tab.Screen
        name="Bills"
        component={BillsScreen}
        options={{ title: 'Bills', tabBarIcon: () => <Text style={{ fontSize: 18 }}>🧾</Text> }}
      />
    </Tab.Navigator>
  );
}

const ROLE_TABS: Record<string, React.ComponentType<any>> = {
  doctor: DoctorTabs,
  nurse: NurseTabs,
  patient: PatientTabs,
};

function AppNavigator() {
  const { profile } = useAuth();
  const role = profile?.role || 'doctor';
  const TabComponent = ROLE_TABS[role] || DoctorTabs;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={TabComponent} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {session ? (
          <Stack.Screen name="App" component={AppNavigator} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
