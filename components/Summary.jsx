import React from 'react'
import { Card, CardContent } from '@/components/ui/card.jsx'

function Summary({ totalen, uitbetalingen }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
      {/* Klant Factuur */}
      <Card className="p-2">
        <CardContent className="p-0">
          <div className="text-center">
            <div className="text-xs font-medium text-muted-foreground mb-1">Klant Betaalt</div>
            <div className="text-xl font-bold text-green-600">€{totalen.klantFactuur.toFixed(0)}</div>
          </div>
        </CardContent>
      </Card>

      {/* Uitbetalingen */}
      <Card className="p-2">
        <CardContent className="p-0">
          <div className="text-xs font-medium text-muted-foreground mb-2">Uitbetalingen</div>
          <div className="space-y-1">
            {uitbetalingen.map((uitbetaling) => (
              <div key={uitbetaling.id} className="flex justify-between items-center text-xs">
                <span className="font-medium">{uitbetaling.naam}</span>
                <div className="flex items-center gap-2">
                  {(uitbetaling.ontvangenUurloonAfdrachten > 0 || uitbetaling.ontvangenMargeAfdrachten > 0) && (
                    <span className="text-muted-foreground">
                      €{uitbetaling.eigenLoon.toFixed(0)}
                      {uitbetaling.ontvangenUurloonAfdrachten > 0 && (
                        <span className="text-blue-600"> +€{uitbetaling.ontvangenUurloonAfdrachten.toFixed(0)}</span>
                      )}
                      {uitbetaling.ontvangenMargeAfdrachten > 0 && (
                        <span className="text-orange-600"> +€{uitbetaling.ontvangenMargeAfdrachten.toFixed(0)}</span>
                      )}
                    </span>
                  )}
                  <span className="font-bold">€{uitbetaling.totaal.toFixed(0)}</span>
                </div>
              </div>
            ))}
            {uitbetalingen.length === 0 && (
              <div className="text-center text-muted-foreground text-xs py-2">
                Geen personen toegevoegd
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Summary
