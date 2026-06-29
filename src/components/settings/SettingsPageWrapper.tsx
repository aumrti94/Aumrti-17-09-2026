import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  title: string;
  children: React.ReactNode;
  onSave?: () => void;
  saving?: boolean;
  hideSave?: boolean;
  wide?: boolean;
}

const SettingsPageWrapper: React.FC<Props> = ({ title, children, onSave, saving, hideSave, wide }) => {
  const navigate = useNavigate();
  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 flex items-center justify-between px-8 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="text-xs text-muted-foreground">Settings › {title}</p>
            <h1 className="text-lg font-bold text-foreground">{title}</h1>
          </div>
        </div>
        {!hideSave && onSave && (
          <Button onClick={onSave} disabled={saving} className="bg-primary text-primary-foreground">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className={wide ? "w-full py-6 px-8" : "max-w-[720px] mx-auto py-8 px-4"}>{children}</div>
      </div>
    </div>
  );
};

export default SettingsPageWrapper;
