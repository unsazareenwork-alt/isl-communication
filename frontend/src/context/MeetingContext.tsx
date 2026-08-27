import { createContext, useContext, useState } from "react";

export interface ActiveMeeting {
  id: string;
  code: string;
  isHost: boolean;
}

interface MeetingContextValue {
  meeting: ActiveMeeting | null;
  setMeeting: (meeting: ActiveMeeting | null) => void;
}

const MeetingContext = createContext<MeetingContextValue | undefined>(undefined);

export function MeetingProvider({ children }: { children: React.ReactNode }) {
  const [meeting, setMeeting] = useState<ActiveMeeting | null>(null);
  return (
    <MeetingContext.Provider value={{ meeting, setMeeting }}>
      {children}
    </MeetingContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMeeting(): MeetingContextValue {
  const ctx = useContext(MeetingContext);
  if (!ctx) {
    throw new Error("useMeeting must be used within a MeetingProvider");
  }
  return ctx;
}
