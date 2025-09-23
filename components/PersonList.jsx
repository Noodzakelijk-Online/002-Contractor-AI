import React from 'react'
import PersonRow from './PersonRow.jsx'
import { Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'

function PersonList({
  personen,
  profielen,
  voegPersoonToe,
  verwijderPersoon,
  updateTijdregistratie,
  updateKlanttarief,
  updateActieveAfdrachten,
  berekenFinancieel
}) {
  return (
    <Card className="p-2">
      <CardHeader className="p-0 mb-2">
        <div className="flex justify-between items-center">
          <CardTitle className="text-sm">Personen & Uren</CardTitle>
          <div className="flex gap-2">
            {profielen.length > 0 ? (
              <Select onValueChange={(profielId) => voegPersoonToe(profielId)}>
                <SelectTrigger className="h-7 w-32 text-xs">
                  <SelectValue placeholder="Voeg persoon toe..." />
                </SelectTrigger>
                <SelectContent>
                  {profielen.map(profiel => (
                    <SelectItem key={profiel.id} value={profiel.id}>
                      {profiel.naam}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="text-xs text-muted-foreground">Maak eerst profielen aan</div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {personen.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground">
            <Users className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p className="text-xs">Selecteer een profiel om te beginnen</p>
          </div>
        ) : (
          <div className="space-y-2">
            {personen.map((persoon) => {
              const financieel = berekenFinancieel(persoon)
              const profiel = profielen.find(p => p.id === persoon.profielId)

              return (
                <PersonRow
                  key={persoon.id}
                  persoon={persoon}
                  profiel={profiel}
                  onVerwijder={verwijderPersoon}
                  onUpdateTijd={updateTijdregistratie}
                  onUpdateKlanttarief={updateKlanttarief}
                  onUpdateActieveAfdrachten={updateActieveAfdrachten}
                  financieel={financieel}
                  profielen={profielen}
                />
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default PersonList
