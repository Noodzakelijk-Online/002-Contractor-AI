import usePersistentState from './usePersistentState.js';
import { Button } from '@/components/ui/button.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Checkbox } from '@/components/ui/checkbox.jsx'
import { Calculator, Euro, Users } from 'lucide-react'
import ProfileManager from './components/ProfileManager.jsx'
import PersonList from './components/PersonList.jsx'
import Summary from './components/Summary.jsx'
import './App.css'

function App() {
  const [personen, setPersonen] = usePersistentState('personen', [])
  const [profielen, setProfielen] = usePersistentState('profielen', [])

  // Functie om een nieuwe persoon toe te voegen vanuit profiel
  const voegPersoonToe = (profielId) => {
    const profiel = profielen.find(p => p.id === profielId)
    if (!profiel) return

    const persoonData = {
      id: Date.now().toString(),
      profielId: profiel.id,
      naam: profiel.naam,
      uurtariefPersoon: profiel.uurtariefPersoon,
      uurtariefKlant: 0, // Flexibel per project
      tijdregistratie: {
        gestart: '',
        gepauzeerd: '',
        hervat: '',
        gestopt: '',
        totaalUren: 0
      },
      actieveAfdrachten: [] // IDs van actieve afdrachten uit het profiel
    }

    setPersonen([...personen, persoonData])
  }

  // Functie om een persoon te verwijderen
  const verwijderPersoon = (id) => {
    setPersonen(personen.filter(p => p.id !== id))
  }

  // Functie om tijdregistratie bij te werken
  const updateTijdregistratie = (id, veld, waarde) => {
    setPersonen(personen.map(p => 
      p.id === id ? { 
        ...p, 
        tijdregistratie: { ...p.tijdregistratie, [veld]: waarde }
      } : p
    ))
  }

  // Functie om klanttarief bij te werken
  const updateKlanttarief = (id, tarief) => {
    setPersonen(personen.map(p => 
      p.id === id ? { ...p, uurtariefKlant: parseFloat(tarief) || 0 } : p
    ))
  }

  // Functie om actieve afdrachten bij te werken
  const updateActieveAfdrachten = (persoonId, afdrachtId, actief) => {
    setPersonen(personen.map(p => 
      p.id === persoonId ? {
        ...p,
        actieveAfdrachten: actief 
          ? [...p.actieveAfdrachten, afdrachtId]
          : p.actieveAfdrachten.filter(id => id !== afdrachtId)
      } : p
    ))
  }

  // Bereken totaal uren voor een persoon
  const berekenTotaalUren = (tijdregistratie) => {
    if (tijdregistratie.totaalUren > 0) {
      return tijdregistratie.totaalUren
    }
    
    if (tijdregistratie.gestart && tijdregistratie.gestopt) {
      const start = new Date(`2024-01-01T${tijdregistratie.gestart}:00`)
      const stop = new Date(`2024-01-01T${tijdregistratie.gestopt}:00`)
      const verschilMs = stop - start
      return Math.max(0, verschilMs / (1000 * 60 * 60))
    }
    
    return 0
  }

  // Bereken financiële gegevens voor een persoon met hiërarchische afdrachten
  const berekenFinancieel = (persoon) => {
    const totaalUren = berekenTotaalUren(persoon.tijdregistratie)
    const kosten = totaalUren * persoon.uurtariefPersoon
    const loon = totaalUren * persoon.uurtariefKlant
    const brutoMarge = loon - kosten
    
    // Bereken actieve afdrachten met prioriteit
    const profiel = profielen.find(p => p.id === persoon.profielId)
    let uurloonAfdrachten = 0
    let margeAfdrachten = 0
    
    if (profiel) {
      // Stap 1: Bereken afdrachten op uurloon (prioriteit 1)
      profiel.afdrachten.forEach(afdracht => {
        if (persoon.actieveAfdrachten.includes(afdracht.id) && afdracht.basis === 'uurloon') {
          if (afdracht.type === 'percentage') {
            uurloonAfdrachten += kosten * (afdracht.waarde / 100)
          } else if (afdracht.type === 'vastbedrag') {
            uurloonAfdrachten += afdracht.waarde
          }
        }
      })
      
      // Stap 2: Bereken resterende marge na uurloon afdrachten
      const resterendeMarge = Math.max(0, brutoMarge - uurloonAfdrachten)
      
      // Stap 3: Bereken afdrachten op resterende marge (prioriteit 2)
      profiel.afdrachten.forEach(afdracht => {
        if (persoon.actieveAfdrachten.includes(afdracht.id) && afdracht.basis === 'marge') {
          if (afdracht.type === 'percentage') {
            margeAfdrachten += resterendeMarge * (afdracht.waarde / 100)
          } else if (afdracht.type === 'vastbedrag') {
            margeAfdrachten += Math.min(afdracht.waarde, resterendeMarge - margeAfdrachten)
          }
        }
      })
    }
    
    const totaleAfdrachten = uurloonAfdrachten + margeAfdrachten
    const nettoMarge = brutoMarge - totaleAfdrachten
    
    return {
      totaalUren,
      kosten,
      loon,
      brutoMarge,
      uurloonAfdrachten,
      margeAfdrachten,
      totaleAfdrachten,
      nettoMarge
    }
  }

  // Bereken uitbetalingen (correcte marge pool verdeling)
  const berekenUitbetalingen = () => {
    const uitbetalingen = {}
    
    // Stap 1: Initialiseer alle profielen in de uitbetalingen object
    profielen.forEach(profiel => {
      uitbetalingen[profiel.id] = {
        naam: profiel.naam,
        eigenLoon: 0,
        ontvangenUurloonAfdrachten: 0,
        ontvangenMargeAfdrachten: 0,
        totaal: 0
      }
    })

    // Stap 2: Voeg het basisloon toe voor elke actieve persoon
    personen.forEach(persoon => {
      const financieel = berekenFinancieel(persoon)
      if (uitbetalingen[persoon.profielId]) {
        uitbetalingen[persoon.profielId].eigenLoon += financieel.kosten
        uitbetalingen[persoon.profielId].totaal += financieel.kosten
      }
    })

    // Stap 2: Bereken totale marge pool
    let totaleMarge = 0
    personen.forEach(persoon => {
      const financieel = berekenFinancieel(persoon)
      totaleMarge += financieel.brutoMarge
    })

    // Stap 3: Verdeel marge volgens hiërarchische afdrachten
    let resterendeMarge = totaleMarge

    // Eerst: Uurloon afdrachten (prioriteit 1)
    personen.forEach(persoon => {
      const profiel = profielen.find(p => p.id === persoon.profielId)
      const financieel = berekenFinancieel(persoon)
      
      if (profiel) {
        profiel.afdrachten.forEach(afdracht => {
          if (persoon.actieveAfdrachten.includes(afdracht.id) && 
              afdracht.basis === 'uurloon' && 
              afdracht.aanProfielId &&
              uitbetalingen[afdracht.aanProfielId]) {
            
            let afdrachtBedrag = 0
            if (afdracht.type === 'percentage') {
              afdrachtBedrag = financieel.kosten * (afdracht.waarde / 100)
            } else if (afdracht.type === 'vastbedrag') {
              afdrachtBedrag = Math.min(afdracht.waarde, resterendeMarge)
            }
            
            afdrachtBedrag = Math.min(afdrachtBedrag, resterendeMarge)
            uitbetalingen[afdracht.aanProfielId].ontvangenUurloonAfdrachten += afdrachtBedrag
            uitbetalingen[afdracht.aanProfielId].totaal += afdrachtBedrag
            resterendeMarge -= afdrachtBedrag
          }
        })
      }
    })

    // Daarna: Marge afdrachten (prioriteit 2) - gelijktijdig berekenen
    const margeAfdrachten = []
    personen.forEach(persoon => {
      const profiel = profielen.find(p => p.id === persoon.profielId)
      
      if (profiel) {
        profiel.afdrachten.forEach(afdracht => {
          if (persoon.actieveAfdrachten.includes(afdracht.id) && 
              afdracht.basis === 'marge' && 
              afdracht.aanProfielId &&
              uitbetalingen[afdracht.aanProfielId]) {
            
            margeAfdrachten.push({
              aanProfielId: afdracht.aanProfielId,
              type: afdracht.type,
              waarde: afdracht.waarde
            })
          }
        })
      }
    })

    // Bereken gewenste bedragen voor alle marge afdrachten
    let totaalGewenstBedrag = 0
    const gewensteBedragen = margeAfdrachten.map(afdracht => {
      let gewenstBedrag = 0
      if (afdracht.type === 'percentage') {
        gewenstBedrag = resterendeMarge * (afdracht.waarde / 100)
      } else if (afdracht.type === 'vastbedrag') {
        gewenstBedrag = afdracht.waarde
      }
      totaalGewenstBedrag += gewenstBedrag
      return { ...afdracht, gewenstBedrag }
    })

    // Verdeel de resterende marge
    gewensteBedragen.forEach(afdracht => {
      let afdrachtBedrag = 0
      
      if (totaalGewenstBedrag <= resterendeMarge) {
        // Er is genoeg marge voor iedereen
        afdrachtBedrag = afdracht.gewenstBedrag
      } else {
        // Proportionele verdeling als er niet genoeg is
        const proportie = afdracht.gewenstBedrag / totaalGewenstBedrag
        afdrachtBedrag = resterendeMarge * proportie
      }
      
      uitbetalingen[afdracht.aanProfielId].ontvangenMargeAfdrachten += afdrachtBedrag
      uitbetalingen[afdracht.aanProfielId].totaal += afdrachtBedrag
    })

    return Object.entries(uitbetalingen).map(([id, data]) => ({ id, ...data }))
  }

  // Bereken totalen
  const berekenTotalen = () => {
    const totalen = personen.reduce((acc, persoon) => {
      const financieel = berekenFinancieel(persoon)
      return {
        klantFactuur: acc.klantFactuur + financieel.loon,
        totaleAfdrachten: acc.totaleAfdrachten + financieel.totaleAfdrachten
      }
    }, { klantFactuur: 0, totaleAfdrachten: 0 })
    
    return totalen
  }

  const totalen = berekenTotalen()
  const uitbetalingen = berekenUitbetalingen()

  return (
    <div className="min-h-screen bg-background p-2">
      <div className="max-w-6xl mx-auto">
        {/* Compacte Header met Settings */}
        <div className="mb-3 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Urenregistratie Calculator
            </h1>
          </div>
          <ProfileManager
            profielen={profielen}
            setProfielen={setProfielen}
            personen={personen}
            setPersonen={setPersonen}
          />
        </div>

        <Summary totalen={totalen} uitbetalingen={uitbetalingen} />

        <PersonList
          personen={personen}
          profielen={profielen}
          voegPersoonToe={voegPersoonToe}
          verwijderPersoon={verwijderPersoon}
          updateTijdregistratie={updateTijdregistratie}
          updateKlanttarief={updateKlanttarief}
          updateActieveAfdrachten={updateActieveAfdrachten}
          berekenFinancieel={berekenFinancieel}
        />
      </div>
    </div>
  )
}

export default App

