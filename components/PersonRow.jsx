import React from 'react'
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Checkbox } from '@/components/ui/checkbox.jsx'
import { Trash2 } from 'lucide-react'

function PersonRow({ persoon, profiel, onVerwijder, onUpdateTijd, onUpdateKlanttarief, onUpdateActieveAfdrachten, financieel, profielen }) {
  return (
    <div className="border rounded p-2 bg-card">
      {/* Compacte Persoon Info */}
      <div className="grid grid-cols-7 gap-2 mb-2">
        <div className="font-medium text-xs">{persoon.naam}</div>
        <Input
          className="h-6 text-xs"
          type="time"
          value={persoon.tijdregistratie.gestart}
          onChange={(e) => onUpdateTijd(persoon.id, 'gestart', e.target.value)}
          placeholder="Start"
        />
        <Input
          className="h-6 text-xs"
          type="time"
          value={persoon.tijdregistratie.gestopt}
          onChange={(e) => onUpdateTijd(persoon.id, 'gestopt', e.target.value)}
          placeholder="Stop"
        />
        <Input
          className="h-6 text-xs"
          type="number"
          step="0.25"
          value={persoon.tijdregistratie.totaalUren}
          onChange={(e) => onUpdateTijd(persoon.id, 'totaalUren', parseFloat(e.target.value) || 0)}
          placeholder="Uren"
        />
        <Input
          className="h-6 text-xs"
          type="number"
          step="0.01"
          value={persoon.uurtariefKlant}
          onChange={(e) => onUpdateKlanttarief(persoon.id, e.target.value)}
          placeholder="Klant €/u"
        />
        <div className="text-xs text-center">
          <div className="text-muted-foreground">Loon</div>
          <div className="font-bold text-green-600">€{financieel.loon.toFixed(0)}</div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="h-6 text-xs"
          onClick={() => onVerwijder(persoon.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Afdrachten Multi-Select */}
      {profiel && profiel.afdrachten.length > 0 && (
        <div className="border-t pt-2">
          <div className="text-xs font-medium mb-1">Actieve Afdrachten:</div>
          <div className="flex flex-wrap gap-2">
            {profiel.afdrachten.map((afdracht) => {
              const ontvangerProfiel = profielen.find(p => p.id === afdracht.aanProfielId)
              return (
                <div key={afdracht.id} className="flex items-center space-x-1">
                  <Checkbox
                    id={`${persoon.id}-${afdracht.id}`}
                    checked={persoon.actieveAfdrachten.includes(afdracht.id)}
                    onCheckedChange={(checked) => onUpdateActieveAfdrachten(persoon.id, afdracht.id, checked)}
                  />
                  <label htmlFor={`${persoon.id}-${afdracht.id}`} className="text-xs">
                    <span className={afdracht.basis === 'uurloon' ? 'text-blue-600' : 'text-orange-600'}>
                      {afdracht.waarde}{afdracht.type === 'percentage' ? '%' : '€'} van {afdracht.basis}
                    </span>
                    {ontvangerProfiel && (
                      <span> → {ontvangerProfiel.naam}</span>
                    )}
                  </label>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default PersonRow
